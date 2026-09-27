import { OrderItem } from './order.model';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  customerName: string;
  customerEmail: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  createdAt: Date;
  createdBy: string;
}
