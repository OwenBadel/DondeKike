import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { InventoryService } from '../services/inventory.service';
import { OrderService } from '../services/order.service';
import { CatalogService } from '../services/catalog.service';
import { CartService } from '../services/cart.service';
import { Insumo } from '../models/product.model';
import { User } from '../models/user.model';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false
})
export class DashboardPage implements OnInit {

  private authService = inject(AuthService);
  private inventoryService = inject(InventoryService);
  private catalogService = inject(CatalogService);
  private orderService = inject(OrderService);
  private cartService = inject(CartService);
  private router = inject(Router);

  user$!: Observable<User | null>;
  totalInsumos$!: Observable<number>;
  totalCatalog$!: Observable<number>;
  lowStockInsumos$!: Observable<Insumo[]>;
  pendingOrdersCount$!: Observable<number>;
  todayRevenue$!: Observable<number>;
  todayOrdersCount$!: Observable<number>;

  menuItems = [
    { title: 'Punto de Venta', icon: 'cart-outline', route: '/pos', color: 'primary', roles: ['admin', 'waiter'] },
    { title: 'Cocina', icon: 'restaurant-outline', route: '/kitchen', color: 'warning', roles: ['admin', 'kitchen'] },
    { title: 'Catálogo', icon: 'fast-food-outline', route: '/catalog', color: 'tertiary', roles: ['admin'] },
    { title: 'Inventario', icon: 'cube-outline', route: '/inventory', color: 'secondary', roles: ['admin'] },
    { title: 'Historial', icon: 'receipt-outline', route: '/orders', color: 'success', roles: ['admin', 'waiter', 'kitchen'] },
    { title: 'Cierre de Caja', icon: 'wallet-outline', route: '/sales', color: 'success', roles: ['admin'] },
    { title: 'Usuarios', icon: 'person-outline', route: '/users', color: 'dark', roles: ['admin'] }
  ];

  ngOnInit(): void {
    this.user$ = this.authService.user$;

    this.totalInsumos$ = this.inventoryService.allInsumos$.pipe(
      map(insumos => insumos.length)
    );

    this.totalCatalog$ = this.catalogService.allItems$.pipe(
      map(items => items.length)
    );

    this.lowStockInsumos$ = this.inventoryService.lowStockInsumos$;

    this.pendingOrdersCount$ = this.orderService.pendingOrders$.pipe(
      map(orders => orders.length)
    );

    this.todayRevenue$ = this.orderService.getTodayRevenue();

    this.todayOrdersCount$ = this.orderService.getTodayOrders().pipe(
      map(orders => orders.length)
    );
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
    this.inventoryService.refresh();
    this.todayRevenue$ = this.orderService.getTodayRevenue();
    this.todayOrdersCount$ = this.orderService.getTodayOrders().pipe(
      map(orders => orders.length)
    );
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  logout(): void {
    this.cartService.clear();
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  isMenuVisible(item: { roles: string[] }): boolean {
    const role = this.authService.userRole;
    return role ? item.roles.includes(role) : false;
  }
}
