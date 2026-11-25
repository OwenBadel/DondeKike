import { TestBed } from '@angular/core/testing';
import { InventoryService } from './inventory.service';
import { SupabaseService } from './supabase.service';
import { CatalogItem } from '../models/catalog.model';
import { CartItem } from './cart.service';

describe('InventoryService', () => {
  let service: InventoryService;

  const mockInsumos = [
    { id: 'ins_pan', name: 'Pan Sencillo (unidad)', image: '', stock: 3, low_stock_threshold: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'ins_salchicha', name: 'Cunit (unidad)', image: '', stock: 10, low_stock_threshold: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'ins_queso', name: 'Queso (porción)', image: '', stock: 1, low_stock_threshold: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'ins_coca', name: 'Coca-Cola', image: '', stock: 2, low_stock_threshold: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];

  const supabaseStub = {
    client: {
      from: () => ({
        select: () => ({
          order: async () => ({ data: mockInsumos, error: null })
        })
      }),
      channel: () => ({
        on: function () { return this; },
        subscribe: () => ({})
      })
    }
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        InventoryService,
        { provide: SupabaseService, useValue: supabaseStub }
      ]
    });

    service = TestBed.inject(InventoryService);
    await service.refresh();
  });

  it('calcula correctamente las porciones disponibles según receta', () => {
    const perro: CatalogItem = {
      id: 'cat_1',
      name: 'Perro Sencillo',
      image: '',
      content: 'Pan y salchicha',
      price: 10000,
      category: 'Perros',
      sortOrder: 1,
      insumoRecipe: [
        { insumoId: 'ins_pan', quantity: 1 },
        { insumoId: 'ins_salchicha', quantity: 1 }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(service.getProductMaxServings(perro)).toBe(3);
  });

  it('detecta stock insuficiente en queso extra y bebidas sin receta explícita', () => {
    const perro: CatalogItem = {
      id: 'cat_1',
      name: 'Perro Sencillo',
      image: '',
      content: 'Pan y salchicha',
      price: 10000,
      category: 'Perros',
      sortOrder: 1,
      insumoRecipe: [
        { insumoId: 'ins_pan', quantity: 1 },
        { insumoId: 'ins_salchicha', quantity: 1 }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const bebida: CatalogItem = {
      id: 'cat_2',
      name: 'Coca-Cola Personal',
      image: '',
      content: 'Fría',
      price: 4000,
      category: 'Bebidas',
      sortOrder: 2,
      insumoRecipe: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const cart: CartItem[] = [
      {
        cartItemId: 'cat_1_cheese',
        productId: 'cat_1',
        productName: 'Perro Sencillo + Queso',
        quantity: 2,
        unitPrice: 13000,
        subtotal: 26000,
        cheeseExtra: true,
        catalogItem: perro
      },
      {
        cartItemId: 'cat_2_plain',
        productId: 'cat_2',
        productName: 'Coca-Cola Personal',
        quantity: 3,
        unitPrice: 4000,
        subtotal: 12000,
        cheeseExtra: false,
        catalogItem: bebida
      }
    ];

    const check = service.validateCartStock(cart);
    expect(check.valid).toBeFalse();
    expect(check.missing.some(m => m.name.includes('Queso'))).toBeTrue();
    expect(check.missing.some(m => m.name.includes('Coca-Cola'))).toBeTrue();
  });
});
