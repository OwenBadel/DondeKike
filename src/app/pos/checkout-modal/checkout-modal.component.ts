import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ModalController, LoadingController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CartService, CartItem } from '../../services/cart.service';
import { OrderService } from '../../services/order.service';
import { InvoiceService } from '../../services/invoice.service';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { AlertService } from '../../services/alert.service';
import { PaymentMethod, OrderType } from '../../models/order.model';

@Component({
  selector: 'app-checkout-modal',
  templateUrl: './checkout-modal.component.html',
  styleUrls: ['./checkout-modal.component.scss'],
  standalone: false
})
export class CheckoutModalComponent implements OnInit, OnDestroy {

  private fb = inject(FormBuilder);
  private cartService = inject(CartService);
  private orderService = inject(OrderService);
  private invoiceService = inject(InvoiceService);
  private authService = inject(AuthService);
  private inventoryService = inject(InventoryService);
  private alertService = inject(AlertService);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);

  checkoutForm!: FormGroup;
  cartItems$!: Observable<CartItem[]>;
  total$!: Observable<number>;

  orderCompleted = false;
  orderNumber = 0;
  invoiceNumber = '';

  // Opciones de despacho y pago
  orderType: OrderType = 'Comer Aquí';
  paymentMethod: PaymentMethod = 'Efectivo';
  cashReceived: number | null = null;
  cashChange = 0;
  selectedCashOption: 'exact' | number | 'custom' = 'exact';

  paymentMethods: PaymentMethod[] = ['Efectivo', 'Transferencia'];
  orderTypes: OrderType[] = ['Comer Aquí', 'Para Llevar'];

  quickNotes = [
    'Sin Cebolla',
    'Sin Salsas',
    'Salsas Aparte',
    'Poco Picante',
    'Bien Asado',
    'Empacar Bien'
  ];

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.cartItems$ = this.cartService.items$;
    this.total$ = this.cartService.total$;

    this.cashReceived = this.cartService.currentTotal;
    this.cashChange = 0;

    this.total$
      .pipe(takeUntil(this.destroy$))
      .subscribe(total => {
        if (this.selectedCashOption === 'exact') {
          this.cashReceived = total;
          this.cashChange = 0;
        }
      });

    this.checkoutForm = this.fb.group({
      customerName: [''],
      notes: ['']
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setOrderType(type: OrderType): void {
    this.orderType = type;
  }

  setPaymentMethod(method: PaymentMethod): void {
    this.paymentMethod = method;
    if (method !== 'Efectivo') {
      this.cashReceived = null;
      this.cashChange = 0;
    }
  }

  setQuickCash(amount: number): void {
    const total = this.cartService.currentTotal;
    this.selectedCashOption = amount;
    this.cashReceived = amount;
    this.cashChange = Math.max(0, amount - total);
  }

  setExactCash(): void {
    const total = this.cartService.currentTotal;
    this.selectedCashOption = 'exact';
    this.cashReceived = total;
    this.cashChange = 0;
  }

  onCashReceivedChange(event: any): void {
    const val = Number(event.detail?.value || event.target?.value || 0);
    this.selectedCashOption = 'custom';
    this.cashReceived = val;
    const total = this.cartService.currentTotal;
    this.cashChange = Math.max(0, val - total);
  }

  toggleQuickNote(chip: string): void {
    const currentNotes = (this.checkoutForm.get('notes')?.value || '').trim();
    if (currentNotes.includes(chip)) {
      const updated = currentNotes
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s !== chip && s.length > 0)
        .join(', ');
      this.checkoutForm.patchValue({ notes: updated });
    } else {
      const updated = currentNotes.length > 0 ? `${currentNotes}, ${chip}` : chip;
      this.checkoutForm.patchValue({ notes: updated });
    }
  }

  isChipSelected(chip: string): boolean {
    const currentNotes = this.checkoutForm.get('notes')?.value || '';
    return currentNotes.includes(chip);
  }

  async confirmOrder(): Promise<void> {
    const total = this.cartService.currentTotal;

    if (this.paymentMethod === 'Efectivo' && this.cashReceived && this.cashReceived < total) {
      this.alertService.toast(`El dinero recibido ($${this.cashReceived.toLocaleString()}) es menor al total ($${total.toLocaleString()})`, 'warning');
      return;
    }

    // 1. VALIDACIÓN ESTRICTA DE STOCK
    const stockCheck = this.inventoryService.validateCartStock(this.cartService.currentItems);
    if (!stockCheck.valid) {
      await this.alertService.stockWarning(stockCheck.missing);
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Registrando pedido...'
    });
    await loading.present();

    try {
      const formValue = this.checkoutForm.value;
      const items = this.cartService.getOrderItems();
      const subtotal = this.cartService.currentSubtotal;
      const tax = this.cartService.currentTax;
      const createdBy = this.authService.currentUser?.fullName || 'Sistema';

      const rawCustomer = formValue.customerName?.trim();
      const customerName = (rawCustomer && rawCustomer.toLowerCase() !== 'sin nombre') ? rawCustomer : 'Cliente Mostrador';

      // Transacción atómica en PostgreSQL
      const result = await this.orderService.createOrderAtomic(
        items,
        subtotal,
        tax,
        total,
        customerName,
        formValue.notes || '',
        createdBy,
        stockCheck.deductions,
        this.paymentMethod,
        this.orderType,
        '',
        this.cashReceived || 0,
        this.cashChange,
        this.cartService.taxRate,
        this.invoiceService.BUSINESS_INFO
      );

      await loading.dismiss();

      if (!result.success || !result.order) {
        await this.alertService.modal('Error al Registrar Pedido', result.message || 'Error al procesar el pedido.', 'error');
        return;
      }

      this.cartService.clear();
      this.orderNumber = result.order.orderNumber;
      this.invoiceNumber = result.invoice?.invoice_number || `FAC-${result.order.orderNumber.toString().padStart(6, '0')}`;
      this.orderCompleted = true;

      this.alertService.toast(`¡Pedido #${result.order.orderNumber} registrado exitosamente!`, 'success');

    } catch (error: any) {
      await loading.dismiss();
      await this.alertService.modal('Error Inesperado', error.message || 'Error al procesar el pedido.', 'error');
    }
  }

  close(): void {
    this.modalCtrl.dismiss({ completed: this.orderCompleted });
  }
}
