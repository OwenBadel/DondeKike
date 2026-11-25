import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { InventoryService } from '../services/inventory.service';
import { OrderService } from '../services/order.service';
import { CatalogService } from '../services/catalog.service';
import { CartService } from '../services/cart.service';
import { AlertService } from '../services/alert.service';
import { Insumo } from '../models/product.model';
import { Order, OrderStatus } from '../models/order.model';
import { User, UserRole } from '../models/user.model';

interface DashboardModuleItem {
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  accent: 'brand' | 'gold' | 'success' | 'neutral';
  roles: UserRole[];
  badgeKey?: 'pending' | 'lowStock' | 'catalog';
}

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
  private alertService = inject(AlertService);
  private router = inject(Router);

  user$!: Observable<User | null>;
  totalInsumos$!: Observable<number>;
  totalCatalog$!: Observable<number>;
  lowStockInsumos$!: Observable<Insumo[]>;
  pendingOrdersCount$!: Observable<number>;
  inProgressOrdersCount$!: Observable<number>;
  todayCompletedCount$!: Observable<number>;
  todayRevenue$!: Observable<number>;
  todayAverageTicket$!: Observable<number>;
  todayOrdersCount$!: Observable<number>;
  recentTodayOrders$!: Observable<Order[]>;

  todayDate = new Date();

  menuItems: DashboardModuleItem[] = [
    {
      title: 'Punto de Venta',
      subtitle: 'Tomar pedidos y cobrar',
      icon: 'cart-outline',
      route: '/pos',
      accent: 'brand',
      roles: ['admin', 'waiter']
    },
    {
      title: 'Monitor de Cocina',
      subtitle: 'Comandas activas en vivo',
      icon: 'flame-outline',
      route: '/kitchen',
      accent: 'gold',
      roles: ['admin', 'kitchen'],
      badgeKey: 'pending'
    },
    {
      title: 'Historial de Pedidos',
      subtitle: 'Órdenes y comprobantes',
      icon: 'receipt-outline',
      route: '/orders',
      accent: 'neutral',
      roles: ['admin', 'waiter', 'kitchen']
    },
    {
      title: 'Cierre de Caja',
      subtitle: 'Arqueo y métricas diarias',
      icon: 'wallet-outline',
      route: '/sales',
      accent: 'success',
      roles: ['admin']
    },
    {
      title: 'Catálogo del Menú',
      subtitle: 'Platos, precios y recetas',
      icon: 'fast-food-outline',
      route: '/catalog',
      accent: 'brand',
      roles: ['admin'],
      badgeKey: 'catalog'
    },
    {
      title: 'Inventario',
      subtitle: 'Control y reabastecimiento',
      icon: 'cube-outline',
      route: '/inventory',
      accent: 'gold',
      roles: ['admin'],
      badgeKey: 'lowStock'
    },
    {
      title: 'Equipo y Accesos',
      subtitle: 'Usuarios, roles y PIN',
      icon: 'people-outline',
      route: '/users',
      accent: 'neutral',
      roles: ['admin']
    }
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

    this.inProgressOrdersCount$ = this.orderService.pendingOrders$.pipe(
      map(orders => orders.filter(o => o.status === 'in-progress').length)
    );

    this.todayCompletedCount$ = this.orderService.todayCompletedOrders$.pipe(
      map(orders => orders.length)
    );

    this.todayRevenue$ = this.orderService.getTodayRevenue();

    this.todayAverageTicket$ = this.orderService.getTodayOrders().pipe(
      map(orders => {
        const valid = orders.filter(o => o.status !== 'cancelled' && o.status !== 'reversed');
        if (valid.length === 0) return 0;
        const total = valid.reduce((sum, o) => sum + o.total, 0);
        return Math.round(total / valid.length);
      })
    );

    this.todayOrdersCount$ = this.orderService.getTodayOrders().pipe(
      map(orders => orders.length)
    );

    this.recentTodayOrders$ = this.orderService.getTodayOrders().pipe(
      map(orders =>
        [...orders]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 5)
      )
    );
  }

  ionViewWillEnter(): void {
    this.todayDate = new Date();
    this.orderService.refresh();
    this.inventoryService.refresh();
    this.catalogService.refresh();
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  async logout(): Promise<void> {
    const confirmed = await this.alertService.confirm(
      '¿Cerrar sesión?',
      'Se limpiará el carrito actual y volverás a la pantalla de acceso.',
      'Cerrar sesión',
      'Seguir aquí',
      'question'
    );
    if (!confirmed) return;

    this.cartService.clear();
    this.authService.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  isMenuVisible(item: DashboardModuleItem, role: UserRole | null): boolean {
    return role ? item.roles.includes(role) : false;
  }

  getVisibleMenuCount(role: UserRole | null): number {
    if (!role) return 0;
    return this.menuItems.filter(item => item.roles.includes(role)).length;
  }

  getOrderStatusLabel(status: OrderStatus): string {
    switch (status) {
      case 'pending': return 'Pendiente';
      case 'in-progress': return 'En cocina';
      case 'completed': return 'Despachado';
      case 'cancelled': return 'Cancelado';
      case 'reversed': return 'Anulado';
      default: return status;
    }
  }

  getOrderStatusTone(status: OrderStatus): string {
    switch (status) {
      case 'pending': return 'warning';
      case 'in-progress': return 'brand';
      case 'completed': return 'success';
      case 'cancelled':
      case 'reversed': return 'danger';
      default: return 'neutral';
    }
  }

  getRoleLabel(role: UserRole): string {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'waiter': return 'Mesero / Caja';
      case 'kitchen': return 'Cocina KDS';
      default: return role;
    }
  }
}
