export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  cheeseExtra?: boolean;
}

export type OrderStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'reversed';

export type PaymentMethod = 'Efectivo' | 'Transferencia';

export type OrderType = 'Comer Aquí' | 'Para Llevar';

export interface InsumoDeduction {
  insumoId: string;
  quantity: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: OrderStatus;
  customerName: string;
  customerEmail?: string;
  notes: string;
  paymentMethod: PaymentMethod;
  orderType: OrderType;
  tableNumber?: string;
  cashReceived?: number;
  cashChange?: number;
  createdAt: Date;
  completedAt?: Date;
  createdBy: string;
  insumoDeductions?: InsumoDeduction[];
}
