import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Invoice } from '../models/invoice.model';
import { Order } from '../models/order.model';
import { SupabaseService } from './supabase.service';
import { BUSINESS_INFO, normalizeCustomerName } from '../utils/order-format.util';

@Injectable({ providedIn: 'root' })
export class InvoiceService {

  private sb = inject(SupabaseService);

  readonly BUSINESS_INFO = {
    businessName: BUSINESS_INFO.businessName,
    businessAddress: BUSINESS_INFO.businessAddress,
    businessPhone: BUSINESS_INFO.businessPhone
  };

  private invoices$ = new BehaviorSubject<Invoice[]>([]);

  constructor() {
    this.loadInvoices();
  }

  get allInvoices$(): Observable<Invoice[]> {
    return this.invoices$.asObservable();
  }

  async generateInvoice(order: Order, taxRate: number): Promise<Invoice | null> {
    const invoiceNumber = await this.getNextInvoiceNumber();

    const row = {
      id: this.generateId(),
      invoice_number: `FAC-${invoiceNumber.toString().padStart(6, '0')}`,
      order_id: order.id,
      items: order.items,
      subtotal: order.subtotal,
      tax: order.tax,
      tax_rate: taxRate,
      total: order.total,
      customer_name: normalizeCustomerName(order.customerName),
      customer_email: order.customerEmail || '',
      business_name: this.BUSINESS_INFO.businessName,
      business_address: this.BUSINESS_INFO.businessAddress,
      business_phone: this.BUSINESS_INFO.businessPhone,
      created_by: order.createdBy
    };

    const { error } = await this.sb.client.from('invoices').insert(row);
    if (error) {
      return null;
    }

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
    // Usar el máximo existente en invoices si no existe tabla legacy counters
    const { data: latest } = await this.sb.client
      .from('invoices')
      .select('invoice_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.invoice_number) {
      const num = parseInt(String(latest.invoice_number).replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(num) && num > 0) {
        return num + 1;
      }
    }

    return this.invoices$.value.length + 1;
  }

  private mapRow(row: any): Invoice {
    let items: any[] = [];
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
    } catch {
      items = [];
    }

    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      orderId: row.order_id,
      items,
      subtotal: Number(row.subtotal) || 0,
      tax: Number(row.tax) || 0,
      taxRate: Number(row.tax_rate) || 0,
      total: Number(row.total) || 0,
      customerName: normalizeCustomerName(row.customer_name),
      customerEmail: row.customer_email || '',
      businessName: row.business_name || this.BUSINESS_INFO.businessName,
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
