import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Order, OrderItem } from '../models/order.model';
import { Invoice } from '../models/invoice.model';
import { OrderService } from '../services/order.service';
import { InvoiceService } from '../services/invoice.service';
import { AuthService } from '../services/auth.service';
import { AlertService } from '../services/alert.service';
import { getCleanProductName } from '../utils/order-format.util';

type OrderFilter = 'all' | 'active' | 'completed' | 'voided';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: false
})
export class OrdersPage implements OnInit, OnDestroy {

  private orderService = inject(OrderService);
  private invoiceService = inject(InvoiceService);
  private authService = inject(AuthService);
  private alertService = inject(AlertService);

  allOrders: Order[] = [];
  filteredOrders: Order[] = [];
  selectedOrder: Order | null = null;
  relatedInvoice: Invoice | undefined;

  searchTerm = '';
  statusFilter: OrderFilter = 'all';

  private destroy$ = new Subject<void>();

  get showInvoices(): boolean {
    const role = this.authService.userRole;
    return role === 'waiter' || role === 'admin';
  }

  get isAdmin(): boolean {
    return this.authService.userRole === 'admin';
  }

  ngOnInit(): void {
    this.orderService.allOrders$
      .pipe(takeUntil(this.destroy$))
      .subscribe(orders => {
        this.allOrders = [...orders].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        this.applyFilters();

        if (this.selectedOrder) {
          const refreshed = this.allOrders.find(o => o.id === this.selectedOrder!.id);
          if (refreshed) {
            this.selectedOrder = refreshed;
            this.relatedInvoice = this.invoiceService.getInvoiceByOrderId(refreshed.id);
          }
        }
      });

    this.invoiceService.allInvoices$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.selectedOrder) {
          this.relatedInvoice = this.invoiceService.getInvoiceByOrderId(this.selectedOrder.id);
        }
      });
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
    this.invoiceService.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  setFilter(filter: OrderFilter): void {
    this.statusFilter = filter;
    this.applyFilters();
  }

  getCleanName(item: OrderItem): string {
    return getCleanProductName(item);
  }

  viewDetails(order: Order): void {
    this.selectedOrder = order;
    this.relatedInvoice = this.invoiceService.getInvoiceByOrderId(order.id);
  }

  closeDetails(): void {
    this.selectedOrder = null;
    this.relatedInvoice = undefined;
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Pendiente';
      case 'in-progress': return 'En preparación';
      case 'completed': return 'Completado';
      case 'cancelled': return 'Cancelado';
      case 'reversed': return 'Reversado';
      default: return status;
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pending': return 'warning';
      case 'in-progress': return 'brand';
      case 'completed': return 'success';
      case 'cancelled':
      case 'reversed': return 'danger';
      default: return 'neutral';
    }
  }

  canCancelActive(order: Order): boolean {
    return order.status === 'pending' || order.status === 'in-progress';
  }

  canReverseCompleted(order: Order): boolean {
    return this.isAdmin && order.status === 'completed';
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Cancelar Pedido #${order.orderNumber}?`,
      'Se restaurarán los insumos al inventario y el pedido quedará cancelado.',
      'Sí, cancelar pedido',
      'Volver'
    );

    if (!confirmed) return;

    const success = await this.orderService.cancelOrder(order.id);
    if (success) {
      this.alertService.toast(`Pedido #${order.orderNumber} cancelado`, 'info');
      this.closeDetails();
    } else {
      this.alertService.modal('Error', 'No se pudo cancelar el pedido.', 'error');
    }
  }

  async reverseOrder(order: Order): Promise<void> {
    if (!this.isAdmin) return;

    const confirmed = await this.alertService.confirm(
      `¿Reversar Venta #${order.orderNumber}?`,
      'Se restaurarán los insumos y esta venta se descontará del cierre de caja.',
      'Sí, reversar venta',
      'Volver'
    );

    if (!confirmed) return;

    const success = await this.orderService.reverseOrder(order.id);
    if (success) {
      this.alertService.toast(`Pedido #${order.orderNumber} reversado`, 'info');
      this.closeDetails();
    } else {
      this.alertService.modal('Error', 'No se pudo reversar el pedido.', 'error');
    }
  }

  private applyFilters(): void {
    let list = [...this.allOrders];

    if (this.statusFilter === 'active') {
      list = list.filter(o => o.status === 'pending' || o.status === 'in-progress');
    } else if (this.statusFilter === 'completed') {
      list = list.filter(o => o.status === 'completed');
    } else if (this.statusFilter === 'voided') {
      list = list.filter(o => o.status === 'cancelled' || o.status === 'reversed');
    }

    if (this.searchTerm) {
      list = list.filter(o =>
        String(o.orderNumber).includes(this.searchTerm) ||
        o.customerName.toLowerCase().includes(this.searchTerm) ||
        o.items.some(i => i.productName.toLowerCase().includes(this.searchTerm))
      );
    }

    this.filteredOrders = list;
  }
}
