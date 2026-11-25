import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ModalController } from '@ionic/angular';
import { CheckoutModalComponent } from './checkout-modal.component';
import { CartService } from '../../services/cart.service';
import { OrderService } from '../../services/order.service';
import { InvoiceService } from '../../services/invoice.service';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { AlertService } from '../../services/alert.service';
import { HapticsService } from '../../services/haptics.service';

describe('CheckoutModalComponent', () => {
  let component: CheckoutModalComponent;
  let fixture: ComponentFixture<CheckoutModalComponent>;
  let cartService: CartService;

  const orderServiceMock = {
    createOrderAtomic: jasmine.createSpy('createOrderAtomic').and.resolveTo({
      success: true,
      order: { orderNumber: 77 },
      invoice: { invoice_number: 'FAC-000077' }
    })
  };

  const loadingCtrlMock = {
    create: jasmine.createSpy('create').and.resolveTo({
      present: async () => undefined,
      dismiss: async () => undefined
    })
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CheckoutModalComponent],
      imports: [IonicModule.forRoot(), ReactiveFormsModule],
      providers: [
        CartService,
        { provide: OrderService, useValue: orderServiceMock },
        { provide: InvoiceService, useValue: { BUSINESS_INFO: { businessName: 'Donde Kike' } } },
        { provide: AuthService, useValue: { currentUser: { fullName: 'Admin' } } },
        { provide: InventoryService, useValue: { validateCartStock: () => ({ valid: true, missing: [], deductions: [] }) } },
        { provide: AlertService, useValue: { toast: () => undefined, modal: async () => undefined, stockWarning: async () => undefined } },
        { provide: HapticsService, useValue: { tap: async () => undefined, success: async () => undefined, warning: async () => undefined } },
        { provide: ModalController, useValue: { dismiss: async () => undefined } },
        { provide: LoadingController, useValue: loadingCtrlMock }
      ]
    }).compileComponents();

    cartService = TestBed.inject(CartService);
    cartService.addItem({
      id: 'cat_1',
      name: 'Perro Súper',
      image: '',
      content: 'Pan y salchicha',
      price: 20000,
      category: 'Perros',
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }, 1);

    fixture = TestBed.createComponent(CheckoutModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('conserva exactamente el cambio entregado ($30.000) tras confirmar y limpiar el carrito', async () => {
    component.setQuickCash(50000);
    expect(component.cashChange).toBe(30000);

    await component.confirmOrder();

    expect(component.orderCompleted).toBeTrue();
    expect(component.completedTotal).toBe(20000);
    expect(component.completedCashChange).toBe(30000);
    expect(cartService.isEmpty).toBeTrue();
  });
});
