import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Observable, Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Order, OrderItem } from '../models/order.model';
import { OrderService } from '../services/order.service';
import { AuthService } from '../services/auth.service';
import { AlertService } from '../services/alert.service';
import { HapticsService } from '../services/haptics.service';
import { getCleanProductName } from '../utils/order-format.util';

@Component({
  selector: 'app-kitchen',
  templateUrl: './kitchen.page.html',
  styleUrls: ['./kitchen.page.scss'],
  standalone: false
})
export class KitchenPage implements OnInit, OnDestroy {

  private orderService = inject(OrderService);
  private authService = inject(AuthService);
  private alertService = inject(AlertService);
  private haptics = inject(HapticsService);

  pendingOrders$!: Observable<Order[]>;
  completedOrders$!: Observable<Order[]>;
  currentTime = new Date();
  selectedTab: 'pending' | 'completed' = 'pending';
  selectedOrder: Order | null = null;
  soundEnabled = true;

  private previousPendingCount = -1;
  private audioCtx: AudioContext | null = null;
  private destroy$ = new Subject<void>();

  get isAdmin(): boolean {
    return this.authService.userRole === 'admin';
  }

  ngOnInit(): void {
    this.pendingOrders$ = this.orderService.pendingOrders$;
    this.completedOrders$ = this.orderService.todayCompletedOrders$;

    this.pendingOrders$
      .pipe(takeUntil(this.destroy$))
      .subscribe(orders => {
        if (this.previousPendingCount >= 0 && orders.length > this.previousPendingCount && this.soundEnabled) {
          this.playKitchenChime();
        }
        this.previousPendingCount = orders.length;
      });

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
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }

  toggleSound(): void {
    this.soundEnabled = !this.soundEnabled;
    this.alertService.toast(
      this.soundEnabled ? 'Alerta sonora activada' : 'Alerta sonora silenciada',
      'info'
    );
  }

  getCleanName(item: OrderItem): string {
    return getCleanProductName(item);
  }

  async startOrder(order: Order): Promise<void> {
    const updated = await this.orderService.updateOrderStatus(order.id, 'in-progress');
    if (updated) {
      this.haptics.tap();
      this.alertService.toast(`Pedido #${order.orderNumber} en preparación`, 'info');
    } else {
      this.alertService.toast('No se pudo actualizar el estado del pedido', 'error');
    }
  }

  async completeOrder(order: Order): Promise<void> {
    const confirmed = await this.alertService.confirm(
      `¿Despachar Pedido #${order.orderNumber}?`,
      'El pedido pasará a la lista de despachados.',
      'Sí, despachar',
      'Volver',
      'question'
    );

    if (!confirmed) return;

    const updated = await this.orderService.updateOrderStatus(order.id, 'completed');
    if (updated) {
      this.haptics.success();
      this.alertService.toast(`Pedido #${order.orderNumber} despachado`, 'success');
    } else {
      this.alertService.toast('No se pudo despachar el pedido', 'error');
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

    if (!confirmed) return;

    const ok = await this.orderService.cancelOrder(order.id);
    if (ok) {
      this.haptics.warning();
      this.closeDetail();
      this.alertService.toast(`Pedido #${order.orderNumber} cancelado`, 'warning');
    } else {
      this.alertService.modal('Error', 'No se pudo cancelar el pedido.', 'error');
    }
  }

  async reversarOrder(order: Order): Promise<void> {
    if (!this.isAdmin) return;

    const confirmed = await this.alertService.confirm(
      `¿Reversar Pedido #${order.orderNumber}?`,
      'Se restaurarán los insumos y se descontará del cierre de caja.',
      'Sí, reversar',
      'Volver',
      'warning'
    );

    if (!confirmed) return;

    const ok = await this.orderService.reverseOrder(order.id);
    if (ok) {
      this.haptics.warning();
      this.closeDetail();
      this.alertService.toast(`Pedido #${order.orderNumber} reversado`, 'info');
    } else {
      this.alertService.modal('Error', 'No se pudo reversar el pedido.', 'error');
    }
  }

  getElapsedTime(createdAt: Date): string {
    const created = new Date(createdAt);
    const diff = Math.max(0, Math.floor((this.currentTime.getTime() - created.getTime()) / 1000));
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  getUrgencyColor(createdAt: Date): 'success' | 'warning' | 'danger' {
    const created = new Date(createdAt);
    const diffMinutes = Math.max(0, Math.floor((this.currentTime.getTime() - created.getTime()) / 60000));
    if (diffMinutes >= 15) return 'danger';
    if (diffMinutes >= 8) return 'warning';
    return 'success';
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Nuevo';
      case 'in-progress': return 'En preparación';
      case 'completed': return 'Despachado';
      case 'cancelled': return 'Cancelado';
      case 'reversed': return 'Reversado';
      default: return status;
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

      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => undefined);
      }

      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      // Ignorar si el navegador requiere interacción previa para audio
    }
  }
}
