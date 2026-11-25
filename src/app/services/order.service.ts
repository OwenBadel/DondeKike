import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Order, OrderItem, OrderStatus, InsumoDeduction, PaymentMethod, OrderType } from '../models/order.model';
import { SupabaseService } from './supabase.service';
import { InventoryService } from './inventory.service';
import { InvoiceService } from './invoice.service';
import {
  BUSINESS_INFO,
  buildOrderNotesTag,
  normalizeCustomerName,
  parseOrderMetadata
} from '../utils/order-format.util';

@Injectable({ providedIn: 'root' })
export class OrderService {

  private sb = inject(SupabaseService);
  private inventoryService = inject(InventoryService);
  private invoiceService = inject(InvoiceService);

  private orders$ = new BehaviorSubject<Order[]>([]);
  private processingIds = new Set<string>();
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadOrders();
    this.initRealtime();
  }

  get allOrders$(): Observable<Order[]> {
    return this.orders$.asObservable();
  }

  get pendingOrders$(): Observable<Order[]> {
    return this.orders$.pipe(
      map(orders =>
        orders
          .filter(o => o.status === 'pending' || o.status === 'in-progress')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      )
    );
  }

  get todayCompletedOrders$(): Observable<Order[]> {
    return this.getTodayOrders().pipe(
      map(orders => orders.filter(o => o.status === 'completed'))
    );
  }

  getOrderById(id: string): Order | undefined {
    return this.orders$.value.find(o => o.id === id);
  }

  private initRealtime(): void {
    try {
      this.sb.client
        .channel('realtime:orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
          this.scheduleRealtimeRefresh();
        })
        .subscribe();
    } catch {
      // Realtime no configurado en entorno local
    }
  }

  private scheduleRealtimeRefresh(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeTimer = setTimeout(() => {
      this.refresh();
      this.inventoryService.refresh();
    }, 150);
  }

  async createOrderAtomic(
    items: OrderItem[],
    subtotal: number,
    tax: number,
    total: number,
    customerName: string,
    notes: string,
    createdBy: string,
    insumoDeductions: InsumoDeduction[] = [],
    paymentMethod: PaymentMethod = 'Efectivo',
    orderType: OrderType = 'Comer Aquí',
    tableNumber: string = '',
    cashReceived: number = 0,
    cashChange: number = 0,
    taxRate: number = 0,
    businessInfo: any = {
      businessName: BUSINESS_INFO.businessName,
      businessAddress: BUSINESS_INFO.businessAddress,
      businessPhone: BUSINESS_INFO.businessPhone
    }
  ): Promise<{ success: boolean; order?: Order; invoice?: any; message?: string }> {
    if (!items || items.length === 0) {
      return { success: false, message: 'No es posible registrar un pedido vacío.' };
    }

    const orderId = this.generateId();
    const cleanCustomerName = normalizeCustomerName(customerName);
    const cleanTable = orderType === 'Comer Aquí' ? tableNumber.trim() : '';
    const fullNotes = buildOrderNotesTag(
      orderType,
      paymentMethod,
      cleanTable,
      cashReceived,
      cashChange,
      notes
    );

    const basePayload = {
      p_order_id: orderId,
      p_items: items,
      p_subtotal: Math.max(0, Math.round(subtotal)),
      p_tax: Math.max(0, Math.round(tax)),
      p_total: Math.max(0, Math.round(total)),
      p_customer_name: cleanCustomerName,
      p_customer_email: '',
      p_notes: fullNotes,
      p_created_by: createdBy,
      p_deductions: insumoDeductions,
      p_tax_rate: taxRate,
      p_business_info: businessInfo
    };

    try {
      // 1. RPC atómica con firma completa de 15 parámetros
      let { data: rpcData, error: rpcError } = await this.sb.client.rpc('create_order_atomic', {
        ...basePayload,
        p_payment_method: paymentMethod,
        p_order_type: orderType,
        p_table_number: cleanTable
      });

      // Respaldo para instancias previas con firma de 12 parámetros
      if (rpcError && (rpcError.code === 'PGRST202' || (rpcError.message || '').includes('Could not find the function'))) {
        const legacyRes = await this.sb.client.rpc('create_order_atomic', basePayload);
        rpcData = legacyRes.data;
        rpcError = legacyRes.error;
        if (!rpcError && rpcData?.success) {
          await this.syncOrderMetadataColumns(orderId, paymentMethod, orderType, cleanTable);
        }
      }

      if (!rpcError && rpcData) {
        if (rpcData.success) {
          await this.refresh();
          await this.inventoryService.refresh();
          await this.invoiceService.refresh();

          const mappedOrder = this.mapRow({
            ...rpcData.order,
            payment_method: paymentMethod,
            order_type: orderType,
            table_number: cleanTable
          });

          return {
            success: true,
            order: mappedOrder,
            invoice: rpcData.invoice
          };
        }

        return {
          success: false,
          message: rpcData.message || 'No se pudo crear el pedido por falta de stock.'
        };
      }

      if (rpcError) {
        const msg = rpcError.message || '';
        if (msg.includes('Stock insuficiente') || msg.includes('insuficiente') || msg.includes('no encontrado')) {
          return { success: false, message: msg };
        }
      }

      // 2. Fallback transaccional controlado
      return await this.createOrderFallback(
        orderId,
        items,
        Math.max(0, Math.round(subtotal)),
        Math.max(0, Math.round(tax)),
        Math.max(0, Math.round(total)),
        cleanCustomerName,
        fullNotes,
        createdBy,
        insumoDeductions,
        paymentMethod,
        orderType,
        cleanTable,
        cashReceived,
        cashChange,
        taxRate
      );
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error inesperado al crear el pedido.' };
    }
  }

  private async syncOrderMetadataColumns(
    orderId: string,
    paymentMethod: PaymentMethod,
    orderType: OrderType,
    tableNumber: string
  ): Promise<void> {
    try {
      await this.sb.client
        .from('orders')
        .update({
          payment_method: paymentMethod,
          order_type: orderType,
          table_number: tableNumber
        })
        .eq('id', orderId);
    } catch {
      // Columnas opcionales ya respaldadas en notes
    }
  }

  private async createOrderFallback(
    orderId: string,
    items: OrderItem[],
    subtotal: number,
    tax: number,
    total: number,
    customerName: string,
    notes: string,
    createdBy: string,
    insumoDeductions: InsumoDeduction[],
    paymentMethod: PaymentMethod,
    orderType: OrderType,
    tableNumber: string,
    cashReceived: number,
    cashChange: number,
    taxRate: number
  ): Promise<{ success: boolean; order?: Order; invoice?: any; message?: string }> {
    for (const d of insumoDeductions) {
      const insumo = this.inventoryService.getInsumoById(d.insumoId);
      if (insumo && insumo.stock < d.quantity) {
        return {
          success: false,
          message: `Stock insuficiente para "${insumo.name}". Disponible: ${insumo.stock}, Requerido: ${d.quantity}.`
        };
      }
    }

    const orderNumber = await this.getNextOrderNumber();

    const row: Record<string, unknown> = {
      id: orderId,
      order_number: orderNumber,
      items,
      subtotal,
      tax,
      total,
      status: 'pending',
      customer_name: customerName,
      customer_email: '',
      payment_method: paymentMethod,
      order_type: orderType,
      table_number: tableNumber,
      notes,
      created_by: createdBy,
      insumo_deductions: insumoDeductions
    };

    const { error: insertError } = await this.sb.client.from('orders').insert(row);
    if (insertError) {
      return { success: false, message: insertError.message || 'Error al registrar el pedido.' };
    }

    for (const d of insumoDeductions) {
      await this.inventoryService.decrementStock(d.insumoId, d.quantity);
    }

    const order: Order = this.mapRow({
      ...row,
      cash_received: cashReceived,
      cash_change: cashChange,
      created_at: new Date().toISOString()
    });

    const invoice = await this.invoiceService.generateInvoice(order, taxRate);

    await this.refresh();
    await this.inventoryService.refresh();

    return {
      success: true,
      order,
      invoice: invoice ? { invoice_number: invoice.invoiceNumber } : undefined
    };
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order | null> {
    const updates: Record<string, unknown> = { status };
    if (status === 'completed') {
      updates['completed_at'] = new Date().toISOString();
    }

    const { error } = await this.sb.client
      .from('orders')
      .update(updates)
      .eq('id', orderId);

    if (error) return null;
    await this.refresh();
    return this.getOrderById(orderId) || null;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return this.cancelOrReverseOrder(orderId, 'cancelled');
  }

  async reverseOrder(orderId: string): Promise<boolean> {
    return this.cancelOrReverseOrder(orderId, 'reversed');
  }

  private async cancelOrReverseOrder(orderId: string, targetStatus: 'cancelled' | 'reversed'): Promise<boolean> {
    if (this.processingIds.has(orderId)) return false;
    this.processingIds.add(orderId);

    try {
      const { data: rpcData, error } = await this.sb.client.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_new_status: targetStatus
      });

      if (!error && rpcData?.success) {
        await this.refresh();
        await this.inventoryService.refresh();
        return true;
      }

      const order = this.getOrderById(orderId);
      if (!order || order.status === 'cancelled' || order.status === 'reversed') return false;
      if (targetStatus === 'cancelled' && order.status === 'completed') return false;
      if (targetStatus === 'reversed' && order.status !== 'completed') return false;

      if (order.insumoDeductions && order.insumoDeductions.length > 0) {
        for (const deduction of order.insumoDeductions) {
          if (deduction.quantity > 0) {
            await this.inventoryService.incrementStock(deduction.insumoId, deduction.quantity);
          }
        }
      }

      const result = await this.updateOrderStatus(orderId, targetStatus);
      return result !== null;
    } finally {
      this.processingIds.delete(orderId);
    }
  }

  getTodayOrders(): Observable<Order[]> {
    return this.orders$.pipe(
      map(orders => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return orders.filter(o => {
          const d = new Date(o.createdAt);
          return d >= today && d < tomorrow;
        });
      })
    );
  }

  getTodayRevenue(): Observable<number> {
    return this.getTodayOrders().pipe(
      map(orders =>
        orders
          .filter(o => o.status === 'completed')
          .reduce((sum, o) => sum + o.total, 0)
      )
    );
  }

  getOrdersByDate(date: Date): Observable<Order[]> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.orders$.pipe(
      map(orders =>
        orders.filter(o => {
          const d = new Date(o.createdAt);
          return d >= start && d <= end && o.status === 'completed';
        })
      )
    );
  }

  getCashRegisterSummary(date: Date): Observable<{
    totalSales: number;
    orderCount: number;
    averageTicket: number;
    efectivo: number;
    transferencia: number;
    efectivoCount: number;
    transferenciaCount: number;
  }> {
    return this.getOrdersByDate(date).pipe(
      map(orders => {
        const summary = {
          totalSales: 0,
          orderCount: orders.length,
          averageTicket: 0,
          efectivo: 0,
          transferencia: 0,
          efectivoCount: 0,
          transferenciaCount: 0
        };

        for (const o of orders) {
          summary.totalSales += o.total;
          if (o.paymentMethod === 'Transferencia') {
            summary.transferencia += o.total;
            summary.transferenciaCount++;
          } else {
            summary.efectivo += o.total;
            summary.efectivoCount++;
          }
        }

        summary.averageTicket = summary.orderCount > 0
          ? Math.round(summary.totalSales / summary.orderCount)
          : 0;

        return summary;
      })
    );
  }

  getSalesSummaryByDay(): Observable<{ date: string; count: number; total: number }[]> {
    return this.orders$.pipe(
      map(orders => {
        const completed = orders.filter(o => o.status === 'completed');
        const grouped: { [key: string]: { count: number; total: number } } = {};
        for (const o of completed) {
          const d = new Date(o.createdAt);
          const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (!grouped[day]) grouped[day] = { count: 0, total: 0 };
          grouped[day].count++;
          grouped[day].total += o.total;
        }
        return Object.entries(grouped)
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => b.date.localeCompare(a.date));
      })
    );
  }

  async refresh(): Promise<void> {
    const { data } = await this.sb.client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      this.orders$.next(data.map((r: any) => this.mapRow(r)));
    }
  }

  private async loadOrders(): Promise<void> {
    await this.refresh();
  }

  private async getNextOrderNumber(): Promise<number> {
    const { data } = await this.sb.client
      .from('orders')
      .select('order_number')
      .order('order_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const maxFromDb = Number(data?.order_number) || 0;
    const maxFromLocal = this.orders$.value.reduce((max, o) => Math.max(max, o.orderNumber || 0), 0);
    return Math.max(maxFromDb, maxFromLocal) + 1;
  }

  private mapRow(row: any): Order {
    let items: OrderItem[] = [];
    if (typeof row.items === 'string') {
      try { items = JSON.parse(row.items); } catch { items = []; }
    } else if (Array.isArray(row.items)) {
      items = row.items;
    }

    let deductions: InsumoDeduction[] | undefined;
    if (typeof row.insumo_deductions === 'string') {
      try { deductions = JSON.parse(row.insumo_deductions); } catch { deductions = undefined; }
    } else if (Array.isArray(row.insumo_deductions)) {
      deductions = row.insumo_deductions;
    }

    const meta = parseOrderMetadata(row);

    return {
      id: row.id,
      orderNumber: Number(row.order_number) || 0,
      items,
      subtotal: Number(row.subtotal) || 0,
      tax: Number(row.tax) || 0,
      total: Number(row.total) || 0,
      status: row.status as OrderStatus,
      customerName: normalizeCustomerName(row.customer_name),
      customerEmail: row.customer_email || '',
      notes: row.notes || '',
      cleanNotes: meta.cleanNotes,
      paymentMethod: meta.paymentMethod,
      orderType: meta.orderType,
      tableNumber: meta.tableNumber,
      cashReceived: meta.cashReceived,
      cashChange: meta.cashChange,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      createdBy: row.created_by || '',
      insumoDeductions: deductions
    };
  }

  private generateId(): string {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).substring(2, 12);
    return 'ord_' + rand;
  }
}
