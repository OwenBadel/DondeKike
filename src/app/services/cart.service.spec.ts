import { CartService, CHEESE_EXTRA_PRICE } from './cart.service';
import { CatalogItem } from '../models/catalog.model';

describe('CartService', () => {
  let service: CartService;

  const perro: CatalogItem = {
    id: 'cat_perro',
    name: 'Perro Sencillo',
    image: '',
    content: 'Pan, salchicha, salsas',
    price: 10000,
    category: 'Perros',
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const bebida: CatalogItem = {
    id: 'cat_bebida',
    name: 'Coca-Cola Personal',
    image: '',
    content: 'Fría',
    price: 4000,
    category: 'Bebidas',
    sortOrder: 2,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    service = new CartService();
  });

  it('agrega productos y acumula subtotales correctamente', () => {
    service.addItem(perro, 2);
    service.addItem(bebida, 1);

    expect(service.currentItems.length).toBe(2);
    expect(service.currentTotal).toBe(24000);
    expect(service.getProductQuantity(perro.id)).toBe(2);
  });

  it('impide agregar queso extra a bebidas', () => {
    service.addItem(bebida, 1, true);
    expect(service.currentItems[0].cheeseExtra).toBeFalse();
    expect(service.currentItems[0].unitPrice).toBe(4000);
  });

  it('divide una unidad al activar queso extra sin mutar durante simulación', () => {
    service.addItem(perro, 2);
    const simulated = service.simulateToggleCheeseExtra('cat_perro_plain');
    expect(simulated.length).toBe(2);
    expect(service.currentItems.length).toBe(1); // No mutó aún

    service.toggleCheeseExtra('cat_perro_plain');
    expect(service.currentItems.length).toBe(2);
    expect(service.currentTotal).toBe(10000 + 10000 + CHEESE_EXTRA_PRICE);
  });

  it('elimina únicamente la variante indicada por cartItemId sin afectar la otra', () => {
    service.addItem(perro, 1, false);
    service.addItem(perro, 1, true);
    expect(service.currentItems.length).toBe(2);

    service.removeItem('cat_perro_cheese');
    expect(service.currentItems.length).toBe(1);
    expect(service.currentItems[0].cartItemId).toBe('cat_perro_plain');
  });
});
