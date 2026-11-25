import {
  buildOrderNotesTag,
  escapeHtml,
  extractCleanNotes,
  formatCop,
  getCleanProductName,
  normalizeCustomerName,
  parseOrderMetadata
} from './order-format.util';

describe('order-format.util', () => {
  it('escapa caracteres HTML potencialmente peligrosos', () => {
    const raw = `<img src=x onerror="alert('xss')">&`;
    expect(escapeHtml(raw)).toBe('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;');
  });

  it('formatea valores enteros en pesos colombianos sin decimales', () => {
    expect(formatCop(12000)).toContain('12');
    expect(formatCop(12000).startsWith('$')).toBeTrue();
    expect(formatCop(Number.NaN)).toBe('$0');
  });

  it('normaliza nombres vacíos o "Sin Nombre" a Cliente Mostrador', () => {
    expect(normalizeCustomerName('')).toBe('Cliente Mostrador');
    expect(normalizeCustomerName('  sin nombre  ')).toBe('Cliente Mostrador');
    expect(normalizeCustomerName('  Laura Gómez ')).toBe('Laura Gómez');
  });

  it('elimina el sufijo duplicado "+ Queso" en la visualización de ítems', () => {
    expect(getCleanProductName({ productName: 'Perro Sencillo + Queso', cheeseExtra: true })).toBe('Perro Sencillo');
    expect(getCleanProductName({ productName: 'Perro Sencillo', cheeseExtra: true })).toBe('Perro Sencillo');
    expect(getCleanProductName({ productName: 'Coca-Cola Personal', cheeseExtra: false })).toBe('Coca-Cola Personal');
  });

  it('construye y limpia observaciones de cocina sin exponer etiquetas del sistema', () => {
    const built = buildOrderNotesTag('Comer Aquí', 'Efectivo', 'Mesa 4', 20000, 8000, 'Sin cebolla, salsas aparte');
    expect(built).toContain('[Comer Aquí]');
    expect(built).toContain('[Efectivo]');
    expect(built).toContain('[Mesa: Mesa 4]');
    expect(extractCleanNotes(built)).toBe('Sin cebolla, salsas aparte');
    expect(extractCleanNotes('[Para Llevar] [Transferencia]')).toBe('');
  });

  it('resuelve metadatos priorizando columnas de BD y respaldando con notas legacy', () => {
    const fromColumns = parseOrderMetadata({
      payment_method: 'Transferencia',
      order_type: 'Para Llevar',
      table_number: '',
      notes: 'Sin salsas'
    });
    expect(fromColumns.paymentMethod).toBe('Transferencia');
    expect(fromColumns.orderType).toBe('Para Llevar');
    expect(fromColumns.cleanNotes).toBe('Sin salsas');

    const fromLegacyNotes = parseOrderMetadata({
      payment_method: 'Efectivo',
      order_type: 'Mesa',
      notes: '[Para Llevar] [Nequi] [Mesa: Barra] [Recibido: $50.000 | Cambio: $12.000] - Bien asado'
    });
    expect(fromLegacyNotes.paymentMethod).toBe('Transferencia');
    expect(fromLegacyNotes.orderType).toBe('Para Llevar');
    expect(fromLegacyNotes.tableNumber).toBe('Barra');
    expect(fromLegacyNotes.cashReceived).toBe(50000);
    expect(fromLegacyNotes.cashChange).toBe(12000);
    expect(fromLegacyNotes.cleanNotes).toBe('Bien asado');
  });
});
