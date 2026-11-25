import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CatalogItem } from '../models/catalog.model';
import { OrderItem } from '../models/order.model';

export interface CartItem extends OrderItem {
  cartItemId: string;
  catalogItem: CatalogItem;
}

export const CHEESE_EXTRA_PRICE = 3000;

@Injectable({ providedIn: 'root' })
export class CartService {

  private readonly TAX_RATE = 0; // Régimen simplificado (precios finales sin IVA discriminado)

  private cartItems$ = new BehaviorSubject<CartItem[]>([]);

  get items$(): Observable<CartItem[]> {
    return this.cartItems$.asObservable();
  }

  get itemCount$(): Observable<number> {
    return this.cartItems$.pipe(
      map(items => items.reduce((sum, item) => sum + item.quantity, 0))
    );
  }

  get subtotal$(): Observable<number> {
    return this.cartItems$.pipe(
      map(items => items.reduce((sum, item) => sum + item.subtotal, 0))
    );
  }

  get total$(): Observable<number> {
    return this.subtotal$.pipe(
      map(subtotal => Math.round(subtotal + Math.round(subtotal * this.TAX_RATE)))
    );
  }

  get taxRate(): number {
    return this.TAX_RATE;
  }

  get currentItems(): CartItem[] {
    return this.cartItems$.value;
  }

  get currentSubtotal(): number {
    return this.currentItems.reduce((sum, item) => sum + item.subtotal, 0);
  }

  get currentTax(): number {
    return Math.round(this.currentSubtotal * this.TAX_RATE);
  }

  get currentTotal(): number {
    return this.currentSubtotal + this.currentTax;
  }

  get isEmpty(): boolean {
    return this.cartItems$.value.length === 0;
  }

  getProductQuantity(productId: string): number {
    return this.cartItems$.value
      .filter(i => i.productId === productId)
      .reduce((sum, i) => sum + i.quantity, 0);
  }

  addItem(catalogItem: CatalogItem, quantity: number = 1, cheeseExtra: boolean = false): void {
    const safeQty = Math.floor(quantity);
    if (safeQty <= 0) return;

    const allowCheese = cheeseExtra && catalogItem.category !== 'Bebidas';
    const items = [...this.cartItems$.value];
    const cartItemId = this.buildCartItemId(catalogItem.id, allowCheese);
    const existingIndex = items.findIndex(i => i.cartItemId === cartItemId);

    const basePrice = Math.round(catalogItem.price);
    const unitPrice = basePrice + (allowCheese ? CHEESE_EXTRA_PRICE : 0);
    const displayName = allowCheese ? `${catalogItem.name} + Queso` : catalogItem.name;

    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      const newQuantity = existing.quantity + safeQty;
      items[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        subtotal: Math.round(newQuantity * unitPrice)
      };
    } else {
      items.push({
        cartItemId,
        productId: catalogItem.id,
        productName: displayName,
        quantity: safeQty,
        unitPrice,
        subtotal: Math.round(safeQty * unitPrice),
        cheeseExtra: allowCheese,
        catalogItem
      });
    }

    this.cartItems$.next(items);
  }

  /**
   * Simula el estado resultante del carrito al alternar queso extra en un ítem,
   * útil para validar inventario antes de mutar el estado real.
   */
  simulateToggleCheeseExtra(cartItemId: string): CartItem[] {
    const items = this.cartItems$.value.map(i => ({ ...i }));
    const index = this.findItemIndex(items, cartItemId);
    if (index === -1) return items;

    const item = items[index];
    if (item.catalogItem.category === 'Bebidas') return items;

    const newCheeseExtra = !item.cheeseExtra;
    const newCartItemId = this.buildCartItemId(item.productId, newCheeseExtra);
    const unitPrice = Math.round(item.catalogItem.price) + (newCheeseExtra ? CHEESE_EXTRA_PRICE : 0);
    const displayName = newCheeseExtra ? `${item.catalogItem.name} + Queso` : item.catalogItem.name;

    if (item.quantity === 1) {
      const otherIndex = items.findIndex(i => i.cartItemId === newCartItemId);
      if (otherIndex !== -1 && otherIndex !== index) {
        const mergedQty = items[otherIndex].quantity + 1;
        items[otherIndex] = {
          ...items[otherIndex],
          quantity: mergedQty,
          subtotal: Math.round(mergedQty * unitPrice)
        };
        items.splice(index, 1);
      } else {
        items[index] = {
          ...item,
          cartItemId: newCartItemId,
          cheeseExtra: newCheeseExtra,
          productName: displayName,
          unitPrice,
          subtotal: unitPrice
        };
      }
    } else {
      const remainingQty = item.quantity - 1;
      items[index] = {
        ...item,
        quantity: remainingQty,
        subtotal: Math.round(remainingQty * item.unitPrice)
      };

      const otherIndex = items.findIndex(i => i.cartItemId === newCartItemId);
      if (otherIndex !== -1) {
        const mergedQty = items[otherIndex].quantity + 1;
        items[otherIndex] = {
          ...items[otherIndex],
          quantity: mergedQty,
          subtotal: Math.round(mergedQty * unitPrice)
        };
      } else {
        items.push({
          cartItemId: newCartItemId,
          productId: item.productId,
          productName: displayName,
          quantity: 1,
          unitPrice,
          subtotal: unitPrice,
          cheeseExtra: newCheeseExtra,
          catalogItem: item.catalogItem
        });
      }
    }

    return items;
  }

  toggleCheeseExtra(cartItemId: string): void {
    const nextItems = this.simulateToggleCheeseExtra(cartItemId);
    this.cartItems$.next(nextItems);
  }

  removeItem(cartItemId: string): void {
    const items = [...this.cartItems$.value];
    const index = this.findItemIndex(items, cartItemId);
    if (index === -1) return;
    items.splice(index, 1);
    this.cartItems$.next(items);
  }

  updateQuantity(cartItemId: string, quantity: number): void {
    const safeQty = Math.floor(quantity);
    if (safeQty <= 0) {
      this.removeItem(cartItemId);
      return;
    }

    const items = [...this.cartItems$.value];
    const index = this.findItemIndex(items, cartItemId);
    if (index === -1) return;

    const target = items[index];
    items[index] = {
      ...target,
      quantity: safeQty,
      subtotal: Math.round(safeQty * target.unitPrice)
    };

    this.cartItems$.next(items);
  }

  clear(): void {
    this.cartItems$.next([]);
  }

  getOrderItems(): OrderItem[] {
    return this.cartItems$.value.map(({ catalogItem: _c, cartItemId: _id, ...orderItem }) => orderItem);
  }

  private findItemIndex(items: CartItem[], id: string): number {
    const exact = items.findIndex(i => i.cartItemId === id);
    if (exact !== -1) return exact;
    return items.findIndex(i => i.productId === id);
  }

  private buildCartItemId(productId: string, cheeseExtra: boolean): string {
    return `${productId}_${cheeseExtra ? 'cheese' : 'plain'}`;
  }
}
