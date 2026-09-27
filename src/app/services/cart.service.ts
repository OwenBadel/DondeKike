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

  private readonly TAX_RATE = 0; // Sin IVA (restaurante régimen simplificado)

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

  get tax$(): Observable<number> {
    return this.subtotal$.pipe(
      map(subtotal => Math.round(subtotal * this.TAX_RATE * 100) / 100)
    );
  }

  get total$(): Observable<number> {
    return this.subtotal$.pipe(
      map(subtotal => {
        const tax = Math.round(subtotal * this.TAX_RATE * 100) / 100;
        return Math.round((subtotal + tax) * 100) / 100;
      })
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
    return Math.round(this.currentSubtotal * this.TAX_RATE * 100) / 100;
  }

  get currentTotal(): number {
    return this.currentSubtotal + this.currentTax;
  }

  get isEmpty(): boolean {
    return this.cartItems$.value.length === 0;
  }

  addItem(catalogItem: CatalogItem, quantity: number = 1, cheeseExtra: boolean = false): void {
    const items = [...this.cartItems$.value];
    const cartItemId = this.buildCartItemId(catalogItem.id, cheeseExtra);
    const existingIndex = items.findIndex(i => i.cartItemId === cartItemId);

    const basePrice = catalogItem.price;
    const unitPrice = basePrice + (cheeseExtra ? CHEESE_EXTRA_PRICE : 0);
    const displayName = cheeseExtra ? `${catalogItem.name} + Queso` : catalogItem.name;

    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      const newQuantity = existing.quantity + quantity;
      items[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        subtotal: Math.round(newQuantity * unitPrice * 100) / 100
      };
    } else {
      items.push({
        cartItemId,
        productId: catalogItem.id,
        productName: displayName,
        quantity,
        unitPrice,
        subtotal: Math.round(quantity * unitPrice * 100) / 100,
        cheeseExtra,
        catalogItem
      });
    }

    this.cartItems$.next(items);
  }

  toggleCheeseExtra(cartItemIdOrProductId: string): void {
    const items = [...this.cartItems$.value];
    const index = items.findIndex(i => i.cartItemId === cartItemIdOrProductId || i.productId === cartItemIdOrProductId);

    if (index === -1) return;

    const item = items[index];
    const newCheeseExtra = !item.cheeseExtra;

    if (item.quantity === 1) {
      const newCartItemId = this.buildCartItemId(item.productId, newCheeseExtra);
      const otherIndex = items.findIndex(i => i.cartItemId === newCartItemId);
      const unitPrice = item.catalogItem.price + (newCheeseExtra ? CHEESE_EXTRA_PRICE : 0);
      const displayName = newCheeseExtra ? `${item.catalogItem.name} + Queso` : item.catalogItem.name;

      if (otherIndex !== -1 && otherIndex !== index) {
        // Merge with existing line
        items[otherIndex] = {
          ...items[otherIndex],
          quantity: items[otherIndex].quantity + 1,
          subtotal: Math.round((items[otherIndex].quantity + 1) * unitPrice * 100) / 100
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
      // Split 1 unit to the modified version
      items[index] = {
        ...item,
        quantity: item.quantity - 1,
        subtotal: Math.round((item.quantity - 1) * item.unitPrice * 100) / 100
      };

      const newCartItemId = this.buildCartItemId(item.productId, newCheeseExtra);
      const otherIndex = items.findIndex(i => i.cartItemId === newCartItemId);
      const unitPrice = item.catalogItem.price + (newCheeseExtra ? CHEESE_EXTRA_PRICE : 0);
      const displayName = newCheeseExtra ? `${item.catalogItem.name} + Queso` : item.catalogItem.name;

      if (otherIndex !== -1) {
        items[otherIndex] = {
          ...items[otherIndex],
          quantity: items[otherIndex].quantity + 1,
          subtotal: Math.round((items[otherIndex].quantity + 1) * unitPrice * 100) / 100
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

    this.cartItems$.next(items);
  }

  removeItem(cartItemIdOrProductId: string): void {
    const items = this.cartItems$.value.filter(
      i => i.cartItemId !== cartItemIdOrProductId && i.productId !== cartItemIdOrProductId
    );
    this.cartItems$.next(items);
  }

  updateQuantity(cartItemIdOrProductId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(cartItemIdOrProductId);
      return;
    }

    const items = this.cartItems$.value.map(item => {
      if (item.cartItemId === cartItemIdOrProductId || item.productId === cartItemIdOrProductId) {
        return {
          ...item,
          quantity,
          subtotal: Math.round(quantity * item.unitPrice * 100) / 100
        };
      }
      return item;
    });

    this.cartItems$.next(items);
  }

  clear(): void {
    this.cartItems$.next([]);
  }

  getOrderItems(): OrderItem[] {
    return this.cartItems$.value.map(({ catalogItem, cartItemId, ...orderItem }) => orderItem);
  }

  private buildCartItemId(productId: string, cheeseExtra: boolean): string {
    return `${productId}_${cheeseExtra ? 'cheese' : 'plain'}`;
  }
}
