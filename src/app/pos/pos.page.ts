import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { CatalogItem, CATALOG_CATEGORIES } from '../models/catalog.model';
import { CatalogService } from '../services/catalog.service';
import { CartService, CartItem, CHEESE_EXTRA_PRICE } from '../services/cart.service';
import { InventoryService } from '../services/inventory.service';
import { AlertService } from '../services/alert.service';
import { CheckoutModalComponent } from './checkout-modal/checkout-modal.component';

@Component({
  selector: 'app-pos',
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  standalone: false
})
export class PosPage implements OnInit, OnDestroy {

  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private inventoryService = inject(InventoryService);
  private alertService = inject(AlertService);
  private modalCtrl = inject(ModalController);

  allItems: CatalogItem[] = [];
  filteredProducts: CatalogItem[] = [];
  cartItems$!: Observable<CartItem[]>;
  cartTotal$!: Observable<number>;
  cartSubtotal$!: Observable<number>;
  cartTax$!: Observable<number>;
  cartCount$!: Observable<number>;

  selectedCategory = '';
  searchTerm = '';
  categories = CATALOG_CATEGORIES;
  showCart = false;

  cheeseExtraPrice = CHEESE_EXTRA_PRICE;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.cartItems$ = this.cartService.items$;
    this.cartTotal$ = this.cartService.total$;
    this.cartSubtotal$ = this.cartService.subtotal$;
    this.cartTax$ = this.cartService.tax$;
    this.cartCount$ = this.cartService.itemCount$;

    this.catalogService.allItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.allItems = items;
        this.applyFilters();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addToCart(item: CatalogItem): void {
    const currentItems = this.cartService.currentItems;
    const existing = currentItems.find(i => i.productId === item.id && !i.cheeseExtra);
    const newQty = existing ? existing.quantity + 1 : 1;

    let testItems: CartItem[];
    if (existing) {
      testItems = currentItems.map(i => i === existing ? { ...i, quantity: newQty } : i);
    } else {
      testItems = [...currentItems, {
        cartItemId: 'test_' + Date.now(),
        productId: item.id,
        productName: item.name,
        quantity: 1,
        unitPrice: item.price,
        subtotal: item.price,
        catalogItem: item
      }];
    }

    const stockCheck = this.inventoryService.validateCartStock(testItems);
    if (!stockCheck.valid) {
      const missing = stockCheck.missing[0];
      this.alertService.toast(`⚠️ Stock insuficiente de "${missing.name}" (${missing.available} disponibles)`, 'warning');
      return;
    }

    this.cartService.addItem(item, 1);
    this.alertService.toast(`+1 ${item.name}`, 'success');
  }

  toggleCheese(item: CartItem): void {
    this.cartService.toggleCheeseExtra(item.cartItemId || item.productId);
  }

  removeFromCart(item: CartItem): void {
    this.cartService.removeItem(item.cartItemId || item.productId);
  }

  incrementItem(item: CartItem): void {
    const currentItems = this.cartService.currentItems;
    const testItems = currentItems.map(i => {
      if ((i.cartItemId || i.productId) === (item.cartItemId || item.productId)) {
        return { ...i, quantity: i.quantity + 1 };
      }
      return i;
    });

    const stockCheck = this.inventoryService.validateCartStock(testItems);
    if (!stockCheck.valid) {
      const missing = stockCheck.missing[0];
      this.alertService.toast(`⚠️ Stock insuficiente de "${missing.name}" (${missing.available} disponibles)`, 'warning');
      return;
    }

    this.cartService.updateQuantity(item.cartItemId || item.productId, item.quantity + 1);
  }

  decrementItem(item: CartItem): void {
    const key = item.cartItemId || item.productId;
    if (item.quantity > 1) {
      this.cartService.updateQuantity(key, item.quantity - 1);
    } else {
      this.cartService.removeItem(key);
    }
  }

  async clearCart(): Promise<void> {
    if (this.cartService.isEmpty) return;
    const confirmed = await this.alertService.confirm('¿Vaciar carrito?', 'Se eliminarán todos los productos seleccionados.', 'Sí, vaciar', 'Cancelar');
    if (confirmed) {
      this.cartService.clear();
      this.alertService.toast('Carrito vaciado', 'info');
    }
  }

  toggleCart(): void {
    this.showCart = !this.showCart;
  }

  async openCheckout(): Promise<void> {
    if (this.cartService.isEmpty) {
      this.alertService.toast('El carrito está vacío', 'warning');
      return;
    }

    // 1. VALIDACIÓN INMEDIATA DE STOCK EN EL CARRO ANTES DE ABRIR CHECKOUT
    const stockCheck = this.inventoryService.validateCartStock(this.cartService.currentItems);
    if (!stockCheck.valid) {
      await this.alertService.stockWarning(stockCheck.missing);
      return; // Detiene completamente: no permite cobrar si falta stock
    }

    const modal = await this.modalCtrl.create({
      component: CheckoutModalComponent
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.completed) {
      this.showCart = false;
    }
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase() || '';
    this.applyFilters();
  }

  onCategorySelect(category: string): void {
    this.selectedCategory = this.selectedCategory === category ? '' : category;
    this.applyFilters();
  }

  isInCart(productId: string): Observable<boolean> {
    return this.cartItems$.pipe(
      map(items => items.some(i => i.productId === productId))
    );
  }

  private applyFilters(): void {
    let filtered = [...this.allItems];

    if (this.searchTerm) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(this.searchTerm) ||
        p.content.toLowerCase().includes(this.searchTerm)
      );
    }

    if (this.selectedCategory) {
      filtered = filtered.filter(p => p.category === this.selectedCategory);
    }

    this.filteredProducts = filtered;
  }
}
