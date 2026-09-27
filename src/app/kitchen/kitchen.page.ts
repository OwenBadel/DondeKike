import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Observable, Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Order } from '../models/order.model';
import { OrderService } from '../services/order.service';
import { AlertService } from '../services/alert.service';

@Component({
  selector: 'app-kitchen',
  templateUrl: './kitchen.page.html',
  styleUrls: ['./kitchen.page.scss'],
  standalone: false
})
export class KitchenPage implements OnInit, OnDestroy {

  private orderService = inject(OrderService);
  private alertService = inject(AlertService);

  pendingOrders$!: Observable<Order[]>;
  completedOrders$!: Observable<Order[]>;
  currentTime = new Date();
  selectedTab = 'pending';
  selectedOrder: Order | null = null;
  private previousPendingCount = -1;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.pendingOrders$ = this.orderService.pendingOrders$;
    this.completedOrders$ = this.orderService.completedOrders$;

    // Escuchar cambios para alertar con sonido cuando entra un nuevo pedido
    this.pendingOrders$
      .pipe(takeUntil(this.destroy$))
      .subscribe(orders => {
        if (this.previousPendingCount >= 0 && orders.length > this.previousPendingCount) {
          this.playKitchenChime();
        }
        this.previousPendingCount = orders.length;
      });

    // Actualizar el reloj cada segundo
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.currentTime = new Date();
      });
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async startOrder(order: Order): Promise<void> {
    await this.orderService.updateOrderStatus(order.id, 'in-progress');
    this.alertService.toast(`Pedido #${order.orderNumber} en preparación`, 'info');
  }

  async completeOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Completar Pedido #${order.orderNumber}?`,
      'El pedido quedará marcado como despachado.',
      'Sí, completar',
      'Volver',
      'question'
    );

    if (confirmed) {
      await this.orderService.updateOrderStatus(order.id, 'completed');
      this.alertService.toast(`Pedido #${order.orderNumber} completado`, 'success');
    }
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Cancelar Pedido #${order.orderNumber}?`,
      'Se restaurarán los insumos al inventario y el pedido quedará cancelado.',
      'Sí, cancelar',
      'Volver',
      'warning'
    );

    if (confirmed) {
      await this.orderService.cancelOrder(order.id);
      this.closeDetail();
      this.alertService.toast(`Pedido #${order.orderNumber} cancelado`, 'warning');
    }
  }

  async reversarOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Reversar Pedido #${order.orderNumber}?`,
      'Se restaurarán los insumos y se descontará de ventas y ganancias.',
      'Sí, reversar',
      'Volver',
      'warning'
    );

    if (confirmed) {
      await this.orderService.reverseOrder(order.id);
      this.closeDetail();
      this.alertService.toast(`Pedido #${order.orderNumber} reversado`, 'info');
    }
  }

  getElapsedTime(createdAt: Date): string {
    const created = new Date(createdAt);
    const diff = Math.floor((this.currentTime.getTime() - created.getTime()) / 1000);
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  getUrgencyColor(createdAt: Date): string {
    const created = new Date(createdAt);
    const diff = Math.floor((this.currentTime.getTime() - created.getTime()) / 60000);
    if (diff >= 15) return 'danger';
    if (diff >= 8) return 'warning';
    return 'success';
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

  viewOrderDetail(order: Order): void {
    this.selectedOrder = order;
  }

  closeDetail(): void {
    this.selectedOrder = null;
  }

  private playKitchenChime(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      // AudioContext ignorado si no hubo interacción previa
    }
  }
}
