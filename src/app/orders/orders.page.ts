import { Component, OnInit, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Order } from '../models/order.model';
import { Invoice } from '../models/invoice.model';
import { OrderService } from '../services/order.service';
import { InvoiceService } from '../services/invoice.service';
import { AuthService } from '../services/auth.service';
import { AlertService } from '../services/alert.service';
import { UserRole } from '../models/user.model';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: false
})
export class OrdersPage implements OnInit {

  private orderService = inject(OrderService);
  private invoiceService = inject(InvoiceService);
  private authService = inject(AuthService);
  private alertService = inject(AlertService);

  orders$!: Observable<Order[]>;
  invoices$!: Observable<Invoice[]>;
  selectedOrder: Order | null = null;
  relatedInvoice: Invoice | undefined;
  userRole: UserRole | null = null;

  ngOnInit(): void {
    this.userRole = this.authService.userRole;

    this.orders$ = this.orderService.allOrders$.pipe(
      map(orders => orders.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ))
    );

    this.invoices$ = this.invoiceService.allInvoices$;
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
    this.invoiceService.refresh();
  }

  /** Mesero y Admin pueden ver facturas asociadas */
  get showInvoices(): boolean {
    return this.userRole === 'waiter' || this.userRole === 'admin';
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

  getStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'warning';
      case 'in-progress': return 'primary';
      case 'completed': return 'success';
      case 'cancelled': return 'danger';
      case 'reversed': return 'danger';
      default: return 'medium';
    }
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Cancelar Pedido #${order.orderNumber}?`,
      'Se restaurarán los insumos al inventario y el pedido quedará cancelado.',
      'Sí, cancelar pedido',
      'Volver'
    );

    if (confirmed) {
      const success = await this.orderService.cancelOrder(order.id);
      if (success) {
        this.alertService.toast(`Pedido #${order.orderNumber} cancelado`, 'info');
        this.closeDetails();
      } else {
        this.alertService.modal('Error', 'No se pudo cancelar el pedido.', 'error');
      }
    }
  }
}
