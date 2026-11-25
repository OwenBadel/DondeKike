import { OrderItem, OrderType, PaymentMethod } from '../models/order.model';

export const BUSINESS_INFO = {
  businessName: 'Donde Kike',
  businessTagline: 'La esquina del sabor',
  businessAddress: 'Cartagena de Indias, Colombia',
  businessPhone: 'Atención en punto de venta'
} as const;

/**
 * Escapa caracteres HTML para prevenir inyección XSS en alertas o modales HTML.
 */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatea montos enteros en pesos colombianos (COP) de forma consistente: $12.000
 */
export function formatCop(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return '$' + safe.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

/**
 * Normaliza el nombre del cliente evitando valores vacíos o literales heredados.
 */
export function normalizeCustomerName(name?: string | null): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'sin nombre') {
    return 'Cliente Mostrador';
  }
  return cleaned;
}

/**
 * Devuelve el nombre limpio del producto sin el sufijo heredado "+ Queso",
 * evitando duplicaciones visuales cuando la interfaz muestra el badge de queso extra.
 */
export function getCleanProductName(item: Pick<OrderItem, 'productName' | 'cheeseExtra'>): string {
  const raw = (item.productName || '').trim();
  if (!item.cheeseExtra) {
    return raw;
  }
  return raw.replace(/\s*\+\s*queso$/i, '').trim() || raw;
}

/**
 * Construye la cadena estructurada de notas compatible con esquemas legacy y actuales.
 */
export function buildOrderNotesTag(
  orderType: OrderType,
  paymentMethod: PaymentMethod,
  tableNumber: string = '',
  cashReceived: number = 0,
  cashChange: number = 0,
  userNotes: string = ''
): string {
  const parts: string[] = [`[${orderType}]`, `[${paymentMethod}]`];
  const cleanTable = tableNumber.trim();
  if (cleanTable && orderType === 'Comer Aquí') {
    parts.push(`[Mesa: ${cleanTable}]`);
  }
  if (paymentMethod === 'Efectivo' && cashReceived > 0) {
    parts.push(`[Recibido: ${formatCop(cashReceived)} | Cambio: ${formatCop(cashChange)}]`);
  }
  const metaTag = parts.join(' ');
  const cleanUserNotes = userNotes.trim();
  return cleanUserNotes ? `${metaTag} - ${cleanUserNotes}` : metaTag;
}

/**
 * Extrae únicamente las observaciones humanas escritas para cocina,
 * ocultando las etiquetas de metadatos del sistema ([Comer Aquí] [Efectivo]...).
 */
export function extractCleanNotes(rawNotes?: string | null): string {
  if (!rawNotes) return '';
  let text = rawNotes.trim();

  // Eliminar secuencia inicial de bloques [Etiqueta] repetidos
  const metaPrefixRegex = /^(?:\[[^\]]+\]\s*)+(?:-\s*)?/;
  if (metaPrefixRegex.test(text)) {
    text = text.replace(metaPrefixRegex, '').trim();
  }

  return text;
}

export interface ParsedOrderMetadata {
  paymentMethod: PaymentMethod;
  orderType: OrderType;
  tableNumber: string;
  cashReceived: number;
  cashChange: number;
  cleanNotes: string;
}

/**
 * Resuelve metadatos de una orden priorizando columnas de BD y usando notas
 * estructuradas únicamente como respaldo cuando la columna no esté definida.
 */
export function parseOrderMetadata(row: {
  notes?: string | null;
  payment_method?: string | null;
  order_type?: string | null;
  table_number?: string | null;
  cash_received?: number | null;
  cash_change?: number | null;
}): ParsedOrderMetadata {
  const rawNotes = (row.notes || '').trim();

  // 1. Método de pago
  let paymentMethod: PaymentMethod = 'Efectivo';
  const dbPay = (row.payment_method || '').trim().toLowerCase();
  if (dbPay === 'transferencia' || dbPay === 'nequi' || dbPay === 'daviplata' || dbPay === 'tarjeta') {
    paymentMethod = 'Transferencia';
  } else if (
    rawNotes.includes('[Transferencia]') ||
    rawNotes.includes('[Nequi]') ||
    rawNotes.includes('[Daviplata]') ||
    rawNotes.includes('[Tarjeta]')
  ) {
    paymentMethod = 'Transferencia';
  }

  // 2. Tipo de pedido (respetar etiqueta explícita [Para Llevar] ante default SQL 'Comer Aquí'/'Mesa')
  let orderType: OrderType = 'Comer Aquí';
  const dbType = (row.order_type || '').trim();
  if (dbType === 'Para Llevar' || rawNotes.includes('[Para Llevar]')) {
    orderType = 'Para Llevar';
  } else if (dbType === 'Comer Aquí' || rawNotes.includes('[Comer Aquí]')) {
    orderType = 'Comer Aquí';
  }

  // 3. Número de mesa / referencia
  let tableNumber = (row.table_number || '').trim();
  if (!tableNumber) {
    const tableMatch = rawNotes.match(/\[Mesa:\s*([^\]]+)\]/i);
    if (tableMatch) {
      tableNumber = tableMatch[1].trim();
    }
  }

  // 4. Efectivo recibido y cambio
  let cashReceived = Number(row.cash_received) || 0;
  let cashChange = Number(row.cash_change) || 0;

  if (!cashReceived) {
    const receivedMatch = rawNotes.match(/Recibido:\s*\$([0-9.,]+)/i);
    if (receivedMatch) {
      cashReceived = parseInt(receivedMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
    }
  }

  if (!cashChange) {
    const changeMatch = rawNotes.match(/Cambio:\s*\$([0-9.,]+)/i);
    if (changeMatch) {
      cashChange = parseInt(changeMatch[1].replace(/[^0-9]/g, ''), 10) || 0;
    }
  }

  return {
    paymentMethod,
    orderType,
    tableNumber,
    cashReceived,
    cashChange,
    cleanNotes: extractCleanNotes(rawNotes)
  };
}
