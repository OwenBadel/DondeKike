import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CatalogItem, CATALOG_CATEGORIES } from '../models/catalog.model';
import { CatalogService } from '../services/catalog.service';
import { CartService, CartItem, CHEESE_EXTRA_PRICE } from '../services/cart.service';
import { InventoryService } from '../services/inventory.service';
import { AlertService } from '../services/alert.service';
import { HapticsService } from '../services/haptics.service';
import { CheckoutModalComponent } from './checkout-modal/checkout-modal.component';
import { getCleanProductName } from '../utils/order-format.util';

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
  private haptics = inject(HapticsService);
  private modalCtrl = inject(ModalController);

  allItems: CatalogItem[] = [];
  filteredProducts: CatalogItem[] = [];
  cartItems$!: Observable<CartItem[]>;
  cartTotal$!: Observable<number>;
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
    this.cartCount$ = this.cartService.itemCount$;

    this.catalogService.allItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.allItems = items;
        this.applyFilters();
      });
  }

  ionViewWillEnter(): void {
    this.catalogService.refresh();
    this.inventoryService.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getItemCartQty(productId: string): number {
    return this.cartService.getProductQuantity(productId);
  }

  getAvailableServings(item: CatalogItem): number | null {
    return this.inventoryService.getProductMaxServings(item);
  }

  isOutOfStock(item: CatalogItem): boolean {
    const servings = this.getAvailableServings(item);
    return servings !== null && servings <= 0;
  }

  getCleanName(item: CartItem): string {
    return getCleanProductName(item);
  }

  addToCart(item: CatalogItem): void {
    const currentItems = this.cartService.currentItems;
    const existing = currentItems.find(i => i.productId === item.id && !i.cheeseExtra);
    const newQty = existing ? existing.quantity + 1 : 1;

    const testItems: CartItem[] = existing
      ? currentItems.map(i => (i === existing ? { ...i, quantity: newQty } : i))
      : [
          ...currentItems,
          {
            cartItemId: `${item.id}_plain`,
            productId: item.id,
            productName: item.name,
            quantity: 1,
            unitPrice: item.price,
            subtotal: item.price,
            cheeseExtra: false,
            catalogItem: item
          }
        ];

    const stockCheck = this.inventoryService.validateCartStock(testItems);
    if (!stockCheck.valid) {
      this.haptics.warning();
      const missing = stockCheck.missing[0];
      this.alertService.toast(
        `Stock insuficiente de ${missing.name} (${missing.available} disp.)`,
        'warning'
      );
      return;
    }

    this.cartService.addItem(item, 1);
    this.haptics.tap();
    this.alertService.toast(`+1 ${item.name}`, 'success');
  }

  toggleCheese(item: CartItem): void {
    if (item.catalogItem.category === 'Bebidas') return;

    const key = item.cartItemId || item.productId;
    const simulated = this.cartService.simulateToggleCheeseExtra(key);
    const stockCheck = this.inventoryService.validateCartStock(simulated);

    if (!stockCheck.valid) {
      this.haptics.warning();
      const missing = stockCheck.missing[0];
      this.alertService.toast(
        `Stock insuficiente de ${missing.name} (${missing.available} disp.)`,
        'warning'
      );
      return;
    }

    this.cartService.toggleCheeseExtra(key);
    this.haptics.tap();
  }

  incrementItem(item: CartItem): void {
    const key = item.cartItemId || item.productId;
    const currentItems = this.cartService.currentItems;
    const testItems = currentItems.map(i =>
      (i.cartItemId || i.productId) === key ? { ...i, quantity: i.quantity + 1 } : i
    );

    const stockCheck = this.inventoryService.validateCartStock(testItems);
    if (!stockCheck.valid) {
      this.haptics.warning();
      const missing = stockCheck.missing[0];
      this.alertService.toast(
        `Stock insuficiente de ${missing.name} (${missing.available} disp.)`,
        'warning'
      );
      return;
    }

    this.cartService.updateQuantity(key, item.quantity + 1);
    this.haptics.tap();
  }

  decrementItem(item: CartItem): void {
    const key = item.cartItemId || item.productId;
    if (item.quantity > 1) {
      this.cartService.updateQuantity(key, item.quantity - 1);
    } else {
      this.cartService.removeItem(key);
    }
    this.haptics.tap();
  }

  async clearCart(): Promise<void> {
    if (this.cartService.isEmpty) return;
    const confirmed = await this.alertService.confirm(
      '¿Vaciar orden actual?',
      'Se eliminarán todos los productos del carrito.',
      'Sí, vaciar',
      'Cancelar'
    );
    if (confirmed) {
      this.cartService.clear();
      this.alertService.toast('Orden limpiada', 'info');
    }
  }

  toggleCart(): void {
    this.showCart = !this.showCart;
  }

  async openCheckout(): Promise<void> {
    if (this.cartService.isEmpty) {
      this.alertService.toast('Agrega al menos un producto para cobrar', 'warning');
      return;
    }

    const stockCheck = this.inventoryService.validateCartStock(this.cartService.currentItems);
    if (!stockCheck.valid) {
      this.haptics.warning();
      await this.alertService.stockWarning(stockCheck.missing);
      return;
    }

    this.haptics.impact();
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
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  onCategorySelect(category: string): void {
    this.selectedCategory = this.selectedCategory === category ? '' : category;
    this.applyFilters();
  }

  getCategoryIcon(category: string): string {
    switch (category) {
      case 'Perros': return 'fast-food-outline';
      case 'Hamburguesas': return 'restaurant-outline';
      case 'Bebidas': return 'wine-outline';
      default: return 'pricetag-outline';
    }
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
