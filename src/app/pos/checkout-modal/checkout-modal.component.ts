import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController, LoadingController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CartService, CartItem } from '../../services/cart.service';
import { OrderService } from '../../services/order.service';
import { InvoiceService } from '../../services/invoice.service';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { AlertService } from '../../services/alert.service';
import { HapticsService } from '../../services/haptics.service';
import { PaymentMethod, OrderType } from '../../models/order.model';
import { formatCop, getCleanProductName, normalizeCustomerName } from '../../utils/order-format.util';

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
  private haptics = inject(HapticsService);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);

  checkoutForm!: FormGroup;
  cartItems$!: Observable<CartItem[]>;
  currentTotal = 0;

  orderCompleted = false;
  isSubmitting = false;
  orderNumber = 0;
  invoiceNumber = '';
  completedTotal = 0;
  completedCashChange = 0;
  completedTableNumber = '';

  orderType: OrderType = 'Comer Aquí';
  paymentMethod: PaymentMethod = 'Efectivo';
  cashReceived: number | null = null;
  cashChange = 0;
  selectedCashOption: 'exact' | number | 'custom' = 'exact';

  paymentMethods: PaymentMethod[] = ['Efectivo', 'Transferencia'];
  orderTypes: OrderType[] = ['Comer Aquí', 'Para Llevar'];
  quickCashAmounts = [10000, 20000, 50000, 100000];

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
    this.currentTotal = this.cartService.currentTotal;
    this.cashReceived = this.currentTotal;
    this.cashChange = 0;

    this.cartService.total$
      .pipe(takeUntil(this.destroy$))
      .subscribe(total => {
        if (this.orderCompleted) return;
        this.currentTotal = total;
        if (this.paymentMethod === 'Efectivo' && this.selectedCashOption === 'exact') {
          this.cashReceived = total;
          this.cashChange = 0;
        } else if (this.paymentMethod === 'Efectivo' && this.cashReceived !== null) {
          this.cashChange = Math.max(0, this.cashReceived - total);
        }
      });

    this.checkoutForm = this.fb.group({
      tableNumber: ['', [Validators.maxLength(20)]],
      customerName: ['', [Validators.maxLength(60)]],
      notes: ['', [Validators.maxLength(240)]]
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get isCashInsufficient(): boolean {
    if (this.paymentMethod !== 'Efectivo') return false;
    return this.cashReceived === null || this.cashReceived < this.currentTotal;
  }

  get cashShortage(): number {
    if (this.paymentMethod !== 'Efectivo') return 0;
    return Math.max(0, this.currentTotal - (this.cashReceived ?? 0));
  }

  getCleanName(item: CartItem): string {
    return getCleanProductName(item);
  }

  setOrderType(type: OrderType): void {
    this.orderType = type;
    if (type !== 'Comer Aquí') {
      this.checkoutForm.patchValue({ tableNumber: '' });
    }
    this.haptics.tap();
  }

  setPaymentMethod(method: PaymentMethod): void {
    this.paymentMethod = method;
    if (method === 'Efectivo') {
      this.setExactCash();
    } else {
      this.cashReceived = null;
      this.cashChange = 0;
    }
    this.haptics.tap();
  }

  setQuickCash(amount: number): void {
    this.selectedCashOption = amount;
    this.cashReceived = amount;
    this.cashChange = Math.max(0, amount - this.currentTotal);
    this.haptics.tap();
  }

  setExactCash(): void {
    this.selectedCashOption = 'exact';
    this.cashReceived = this.currentTotal;
    this.cashChange = 0;
    this.haptics.tap();
  }

  onCashReceivedChange(event: any): void {
    const raw = event.detail?.value ?? event.target?.value;
    if (raw === '' || raw === null || raw === undefined) {
      this.selectedCashOption = 'custom';
      this.cashReceived = null;
      this.cashChange = 0;
      return;
    }
    const val = Math.max(0, Math.round(Number(raw) || 0));
    this.selectedCashOption = 'custom';
    this.cashReceived = val;
    this.cashChange = Math.max(0, val - this.currentTotal);
  }

  toggleQuickNote(chip: string): void {
    const currentNotes = (this.checkoutForm.get('notes')?.value || '').trim();
    const tokens = currentNotes
      ? currentNotes.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      : [];

    const exists = tokens.includes(chip);
    const updated = exists
      ? tokens.filter((s: string) => s !== chip).join(', ')
      : [...tokens, chip].join(', ');

    this.checkoutForm.patchValue({ notes: updated.slice(0, 240) });
    this.haptics.tap();
  }

  isChipSelected(chip: string): boolean {
    const currentNotes = this.checkoutForm.get('notes')?.value || '';
    return currentNotes.split(',').map((s: string) => s.trim()).includes(chip);
  }

  async confirmOrder(): Promise<void> {
    if (this.isSubmitting || this.cartService.isEmpty) return;
    if (this.checkoutForm.invalid) {
      this.checkoutForm.markAllAsTouched();
      return;
    }

    const total = this.cartService.currentTotal;
    if (total <= 0) return;

    if (this.paymentMethod === 'Efectivo') {
      if (this.cashReceived === null || this.cashReceived < total) {
        this.haptics.warning();
        this.alertService.toast(
          `El efectivo recibido (${formatCop(this.cashReceived ?? 0)}) es menor al total (${formatCop(total)})`,
          'warning'
        );
        return;
      }
    }

    const stockCheck = this.inventoryService.validateCartStock(this.cartService.currentItems);
    if (!stockCheck.valid) {
      this.haptics.warning();
      await this.alertService.stockWarning(stockCheck.missing);
      return;
    }

    this.isSubmitting = true;
    const loading = await this.loadingCtrl.create({ message: 'Registrando comanda...' });
    await loading.present();

    try {
      const formValue = this.checkoutForm.value;
      const items = this.cartService.getOrderItems();
      const subtotal = this.cartService.currentSubtotal;
      const tax = this.cartService.currentTax;
      const createdBy = this.authService.currentUser?.fullName || 'Sistema';
      const customerName = normalizeCustomerName(formValue.customerName);
      const tableNumber = this.orderType === 'Comer Aquí' ? (formValue.tableNumber || '').trim() : '';
      const finalCashReceived = this.paymentMethod === 'Efectivo' ? (this.cashReceived ?? total) : 0;
      const finalCashChange = this.paymentMethod === 'Efectivo' ? Math.max(0, finalCashReceived - total) : 0;

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
        tableNumber,
        finalCashReceived,
        finalCashChange,
        this.cartService.taxRate,
        this.invoiceService.BUSINESS_INFO
      );

      await loading.dismiss();
      this.isSubmitting = false;

      if (!result.success || !result.order) {
        this.haptics.warning();
        await this.alertService.modal('Error al Registrar Pedido', result.message || 'No se pudo procesar el pedido.', 'error');
        return;
      }

      // Congelar métricas finales ANTES de vaciar el carrito para que total$ -> 0 no altere el cambio
      this.completedTotal = total;
      this.completedCashChange = finalCashChange;
      this.completedTableNumber = tableNumber;
      this.orderNumber = result.order.orderNumber;
      this.invoiceNumber = result.invoice?.invoice_number || `FAC-${result.order.orderNumber.toString().padStart(6, '0')}`;
      this.orderCompleted = true;

      this.cartService.clear();

      this.haptics.success();
      this.alertService.toast(`Pedido #${result.order.orderNumber} enviado a cocina`, 'success');
    } catch (error: any) {
      await loading.dismiss();
      this.isSubmitting = false;
      this.haptics.warning();
      await this.alertService.modal('Error Inesperado', error?.message || 'Error al procesar el pedido.', 'error');
    }
  }

  close(): void {
    this.modalCtrl.dismiss({ completed: this.orderCompleted });
  }
}
