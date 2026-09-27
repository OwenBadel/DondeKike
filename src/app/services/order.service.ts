import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Order, OrderItem, OrderStatus, InsumoDeduction, PaymentMethod, OrderType } from '../models/order.model';
import { SupabaseService } from './supabase.service';
import { InventoryService } from './inventory.service';

@Injectable({ providedIn: 'root' })
export class OrderService {

  private sb = inject(SupabaseService);
  private inventoryService = inject(InventoryService);

  private orders$ = new BehaviorSubject<Order[]>([]);
  private processingIds = new Set<string>();
  private realtimeChannel: any;

  constructor() {
    this.loadOrders();
    this.initRealtime();
  }

  get allOrders$(): Observable<Order[]> {
    return this.orders$.asObservable();
  }

  get pendingOrders$(): Observable<Order[]> {
    return this.orders$.pipe(
      map(orders => orders.filter(o => o.status === 'pending' || o.status === 'in-progress'))
    );
  }

  get completedOrders$(): Observable<Order[]> {
    return this.orders$.pipe(
      map(orders => orders.filter(o => o.status === 'completed'))
    );
  }

  getOrderById(id: string): Order | undefined {
    return this.orders$.value.find(o => o.id === id);
  }

  private initRealtime(): void {
    try {
      this.realtimeChannel = this.sb.client
        .channel('realtime:orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
          this.refresh();
          this.inventoryService.refresh();
        })
        .subscribe();
    } catch {
      // Realtime no configurado en entorno local
    }
  }

  /**
   * Creación transaccional y atómica de pedido con método de pago y tipo de orden
   */
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
      businessName: 'Donde Kike',
      businessAddress: 'Av. Principal #123, Ciudad',
      businessPhone: '+1 (555) 123-4567'
    }
  ): Promise<{ success: boolean; order?: Order; invoice?: any; message?: string }> {
    const orderId = this.generateId();

    const cleanCustomerName = (customerName?.trim() && customerName.trim().toLowerCase() !== 'sin nombre')
      ? customerName.trim()
      : 'Cliente Mostrador';

    // Etiqueta estructurada para notas
    const metaTag = `[${orderType}] [${paymentMethod}]` +
      (cashReceived > 0 ? ` [Recibido: $${cashReceived.toLocaleString()} | Cambio: $${cashChange.toLocaleString()}]` : '');
    const fullNotes = notes ? `${metaTag} - ${notes}` : metaTag;

    try {
      // 1. Intentar RPC atómica si está disponible
      const { data: rpcData, error: rpcError } = await this.sb.client.rpc('create_order_atomic', {
        p_order_id: orderId,
        p_items: items,
        p_subtotal: subtotal,
        p_tax: tax,
        p_total: total,
        p_customer_name: cleanCustomerName,
        p_customer_email: '',
        p_notes: fullNotes,
        p_created_by: createdBy,
        p_deductions: insumoDeductions,
        p_tax_rate: taxRate,
        p_business_info: businessInfo
      });

      if (!rpcError && rpcData) {
        if (rpcData.success) {
          await this.refresh();
          await this.inventoryService.refresh();
          return {
            success: true,
            order: this.mapRow(rpcData.order),
            invoice: rpcData.invoice
          };
        } else {
          // El RPC de Supabase rechazó por stock insuficiente u otra causa
          return {
            success: false,
            message: rpcData.message || 'No se pudo crear el pedido por falta de stock.'
          };
        }
      }

      if (rpcError) {
        const msg = rpcError.message || '';
        if (msg.includes('Stock insuficiente') || msg.includes('insuficiente') || msg.includes('no encontrado')) {
          return { success: false, message: msg };
        }
      }

      // 2. Fallback con numeración secuencial y validación estricta de stock
      const fallbackResult = await this.createOrderFallback(
        orderId, items, subtotal, tax, total, cleanCustomerName, fullNotes, createdBy, insumoDeductions,
        paymentMethod, orderType, tableNumber, cashReceived, cashChange
      );
      return fallbackResult;
    } catch (err: any) {
      return { success: false, message: err.message || 'Error inesperado al crear el pedido.' };
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
    cashChange: number
  ): Promise<{ success: boolean; order?: Order; message?: string }> {
    // 1. Validar stock antes de crear la orden
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

    const row: any = {
      id: orderId,
      order_number: orderNumber,
      items: JSON.stringify(items),
      subtotal,
      tax,
      total,
      status: 'pending',
      customer_name: customerName,
      customer_email: '',
      notes,
      created_by: createdBy,
      insumo_deductions: JSON.stringify(insumoDeductions)
    };

    const { error: insertError } = await this.sb.client.from('orders').insert(row);
    if (insertError) {
      return { success: false, message: insertError.message || 'Error al registrar el pedido.' };
    }

    // 2. Descontar stock de insumos en fallback
    for (const d of insumoDeductions) {
      await this.inventoryService.decrementStock(d.insumoId, d.quantity);
    }

    await this.refresh();
    await this.inventoryService.refresh();

    const order: Order = {
      id: orderId,
      orderNumber,
      items,
      subtotal,
      tax,
      total,
      status: 'pending',
      customerName,
      customerEmail: '',
      notes,
      paymentMethod,
      orderType,
      tableNumber,
      cashReceived,
      cashChange,
      createdAt: new Date(),
      createdBy,
      insumoDeductions
    };

    return { success: true, order };
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order | null> {
    const updates: any = { status };
    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
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
    if (this.processingIds.has(orderId)) return false;
    this.processingIds.add(orderId);

    try {
      const { data: rpcData, error } = await this.sb.client.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_new_status: 'cancelled'
      });

      if (!error && rpcData?.success) {
        await this.refresh();
        await this.inventoryService.refresh();
        return true;
      }

      const order = this.getOrderById(orderId);
      if (!order || order.status === 'cancelled' || order.status === 'reversed') return false;

      if (order.insumoDeductions && order.insumoDeductions.length > 0) {
        for (const deduction of order.insumoDeductions) {
          await this.inventoryService.incrementStock(deduction.insumoId, deduction.quantity);
        }
      }

      const result = await this.updateOrderStatus(orderId, 'cancelled');
      return result !== null;
    } finally {
      this.processingIds.delete(orderId);
    }
  }

  async reverseOrder(orderId: string): Promise<boolean> {
    if (this.processingIds.has(orderId)) return false;
    this.processingIds.add(orderId);

    try {
      const { data: rpcData, error } = await this.sb.client.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_new_status: 'reversed'
      });

      if (!error && rpcData?.success) {
        await this.refresh();
        await this.inventoryService.refresh();
        return true;
      }

      const order = this.getOrderById(orderId);
      if (!order || order.status === 'cancelled' || order.status === 'reversed') return false;

      if (order.insumoDeductions && order.insumoDeductions.length > 0) {
        for (const deduction of order.insumoDeductions) {
          await this.inventoryService.incrementStock(deduction.insumoId, deduction.quantity);
        }
      }

      const result = await this.updateOrderStatus(orderId, 'reversed');
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

  getRevenueByDate(date: Date): Observable<number> {
    return this.getOrdersByDate(date).pipe(
      map(orders => orders.reduce((sum, o) => sum + o.total, 0))
    );
  }

  /**
   * Resumen y Cierre de Caja por Métodos de Pago (Efectivo y Transferencia)
   */
  getCashRegisterSummary(date: Date): Observable<{
    totalSales: number;
    orderCount: number;
    efectivo: number;
    transferencia: number;
  }> {
    return this.getOrdersByDate(date).pipe(
      map(orders => {
        const summary = {
          totalSales: 0,
          orderCount: orders.length,
          efectivo: 0,
          transferencia: 0
        };

        for (const o of orders) {
          summary.totalSales += o.total;
          if (o.paymentMethod === 'Transferencia') {
            summary.transferencia += o.total;
          } else {
            summary.efectivo += o.total;
          }
        }
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
      .from('counters')
      .select('value')
      .eq('key', 'order_counter')
      .maybeSingle();

    const current = data?.value || 0;
    const next = current + 1;

    await this.sb.client
      .from('counters')
      .upsert({ key: 'order_counter', value: next });

    return next;
  }

  // =============================================
  // MAPEO DE DATOS
  // =============================================

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

    const rawNotes = row.notes || '';

    // Extraer método de pago y tipo de orden de las notas o columnas
    let paymentMethod: PaymentMethod = (row.payment_method as PaymentMethod) || 'Efectivo';
    let orderType: OrderType = (row.order_type as OrderType) || 'Comer Aquí';
    const tableNumber = row.table_number || '';
    const cashReceived = row.cash_received || 0;
    let cashChange = row.cash_change || 0;

    // Si no estaban en columnas dedicadas, extraer de las notas
    if (rawNotes.includes('[Transferencia]') || rawNotes.includes('[Nequi]') || rawNotes.includes('[Daviplata]') || rawNotes.includes('[Tarjeta]')) {
      paymentMethod = 'Transferencia';
    } else {
      paymentMethod = 'Efectivo';
    }

    if (rawNotes.includes('[Para Llevar]')) {
      orderType = 'Para Llevar';
    } else {
      orderType = 'Comer Aquí';
    }

    const changeMatch = rawNotes.match(/Cambio:\s*\$([0-9.,]+)/i);
    if (changeMatch) {
      cashChange = parseInt(changeMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
    }

    return {
      id: row.id,
      orderNumber: row.order_number,
      items,
      subtotal: row.subtotal,
      tax: row.tax || 0,
      total: row.total,
      status: row.status as OrderStatus,
      customerName: (row.customer_name?.trim() && row.customer_name.trim().toLowerCase() !== 'sin nombre') ? row.customer_name.trim() : 'Cliente Mostrador',
      customerEmail: '',
      notes: rawNotes,
      paymentMethod,
      orderType,
      tableNumber,
      cashReceived,
      cashChange,
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
