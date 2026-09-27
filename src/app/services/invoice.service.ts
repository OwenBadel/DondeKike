import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Invoice } from '../models/invoice.model';
import { Order } from '../models/order.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class InvoiceService {

  private sb = inject(SupabaseService);

  readonly BUSINESS_INFO = {
    businessName: 'Donde Kike',
    businessAddress: 'Av. Principal #123, Ciudad',
    businessPhone: '+1 (555) 123-4567'
  };

  private invoices$ = new BehaviorSubject<Invoice[]>([]);

  constructor() {
    this.loadInvoices();
  }

  get allInvoices$(): Observable<Invoice[]> {
    return this.invoices$.asObservable();
  }

  async generateInvoice(order: Order, taxRate: number): Promise<Invoice> {
    const invoiceNumber = await this.getNextInvoiceNumber();

    const row = {
      id: this.generateId(),
      invoice_number: `FAC-${invoiceNumber.toString().padStart(6, '0')}`,
      order_id: order.id,
      items: JSON.stringify(order.items),
      subtotal: order.subtotal,
      tax: order.tax,
      tax_rate: taxRate,
      total: order.total,
      customer_name: (order.customerName?.trim() && order.customerName.trim().toLowerCase() !== 'sin nombre') ? order.customerName.trim() : 'Cliente Mostrador',
      customer_email: order.customerEmail,
      business_name: this.BUSINESS_INFO.businessName,
      business_address: this.BUSINESS_INFO.businessAddress,
      business_phone: this.BUSINESS_INFO.businessPhone,
      created_by: order.createdBy
    };

    await this.sb.client.from('invoices').insert(row);
    await this.refresh();

    return this.mapRow({ ...row, created_at: new Date().toISOString() });
  }

  getInvoiceByOrderId(orderId: string): Invoice | undefined {
    return this.invoices$.value.find(i => i.orderId === orderId);
  }

  async refresh(): Promise<void> {
    const { data } = await this.sb.client
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      this.invoices$.next(data.map((r: any) => this.mapRow(r)));
    }
  }

  private async loadInvoices(): Promise<void> {
    await this.refresh();
  }

  private async getNextInvoiceNumber(): Promise<number> {
    const { data } = await this.sb.client
      .from('counters')
      .select('value')
      .eq('key', 'invoice_counter')
      .maybeSingle();

    const current = data?.value || 0;
    const next = current + 1;

    await this.sb.client
      .from('counters')
      .upsert({ key: 'invoice_counter', value: next });

    return next;
  }

  private mapRow(row: any): Invoice {
    let items: any[] = [];
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
    } catch { items = []; }

    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      orderId: row.order_id,
      items,
      subtotal: row.subtotal,
      tax: row.tax,
      taxRate: row.tax_rate,
      total: row.total,
      customerName: (row.customer_name?.trim() && row.customer_name.trim().toLowerCase() !== 'sin nombre') ? row.customer_name.trim() : 'Cliente Mostrador',
      customerEmail: row.customer_email || '',
      businessName: row.business_name || '',
      businessAddress: row.business_address || '',
      businessPhone: row.business_phone || '',
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || ''
    };
  }

  private generateId(): string {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).substring(2, 12);
    return 'inv_' + rand;
  }
}
