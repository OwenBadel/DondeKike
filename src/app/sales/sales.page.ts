import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Chart, registerables } from 'chart.js';
import { OrderService } from '../services/order.service';
import { Order, OrderItem } from '../models/order.model';
import { formatCop, getCleanProductName } from '../utils/order-format.util';

Chart.register(...registerables);

@Component({
  selector: 'app-sales',
  templateUrl: './sales.page.html',
  styleUrls: ['./sales.page.scss'],
  standalone: false
})
export class SalesPage implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('salesChart') salesChartRef?: ElementRef<HTMLCanvasElement>;

  private orderService = inject(OrderService);

  selectedDate: Date = new Date();
  dayOrders$!: Observable<Order[]>;
  cashSummary$!: Observable<{
    totalSales: number;
    orderCount: number;
    averageTicket: number;
    efectivo: number;
    transferencia: number;
    efectivoCount: number;
    transferenciaCount: number;
  }>;
  salesSummary$!: Observable<{ date: string; count: number; total: number }[]>;
  hasChartData = false;

  private latestSummary: { date: string; count: number; total: number }[] = [];
  private viewReady = false;
  private chart: Chart | null = null;
  private chartTimer: ReturnType<typeof setTimeout> | null = null;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadDay();
    this.salesSummary$ = this.orderService.getSalesSummaryByDay();

    this.salesSummary$
      .pipe(takeUntil(this.destroy$))
      .subscribe(summary => {
        this.latestSummary = summary || [];
        this.hasChartData = this.latestSummary.length > 0;
        if (this.viewReady) {
          this.scheduleChartRender();
        }
      });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.latestSummary.length > 0) {
      this.scheduleChartRender();
    }
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
    this.loadDay();
  }

  ngOnDestroy(): void {
    if (this.chartTimer) {
      clearTimeout(this.chartTimer);
      this.chartTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.destroyChart();
  }

  private scheduleChartRender(): void {
    if (this.chartTimer) clearTimeout(this.chartTimer);
    this.chartTimer = setTimeout(() => {
      this.chartTimer = null;
      this.buildChart(this.latestSummary);
    }, 0);
  }

  loadDay(): void {
    this.dayOrders$ = this.orderService.getOrdersByDate(this.selectedDate);
    this.cashSummary$ = this.orderService.getCashRegisterSummary(this.selectedDate);
  }

  getCleanName(item: OrderItem): string {
    return getCleanProductName(item);
  }

  getSharePercent(part: number, total: number): number {
    if (!total || total <= 0) return 0;
    return Math.round((part / total) * 100);
  }

  previousDay(): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() - 1);
    this.selectedDate = d;
    this.loadDay();
  }

  nextDay(): void {
    if (this.isToday()) return;
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() + 1);
    this.selectedDate = d;
    this.loadDay();
  }

  goToToday(): void {
    this.selectedDate = new Date();
    this.loadDay();
  }

  selectDay(dateStr: string): void {
    this.selectedDate = new Date(dateStr + 'T12:00:00');
    this.loadDay();
  }

  isToday(): boolean {
    const today = new Date();
    return this.selectedDate.toDateString() === today.toDateString();
  }

  formatDate(date: Date): string {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  formatDateShort(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  formatDayName(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return days[d.getDay()];
  }

  isSelectedDate(dateStr: string): boolean {
    const d = this.selectedDate;
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return local === dateStr;
  }

  private destroyChart(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  private buildChart(summary: { date: string; count: number; total: number }[]): void {
    this.destroyChart();
    if (!summary.length || !this.salesChartRef?.nativeElement) return;

    const data = [...summary].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const labels = data.map(d => {
      const date = new Date(d.date + 'T12:00:00');
      return `${days[date.getDay()]} ${date.getDate()}`;
    });

    const ctx = this.salesChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ventas ($)',
            data: data.map(d => d.total),
            borderColor: '#15803D',
            backgroundColor: 'rgba(21, 128, 61, 0.1)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.32,
            pointBackgroundColor: '#15803D',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
            pointRadius: 4,
            yAxisID: 'y'
          },
          {
            label: 'Pedidos',
            data: data.map(d => d.count),
            borderColor: '#D9480F',
            backgroundColor: 'rgba(217, 72, 15, 0.08)',
            borderWidth: 2,
            fill: false,
            tension: 0.32,
            pointBackgroundColor: '#D9480F',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
            pointRadius: 4,
            borderDash: [5, 3],
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 12, weight: 'bold' } }
          },
          tooltip: {
            backgroundColor: '#1C1917',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (item: any) =>
                item.datasetIndex === 0
                  ? ` Ventas: ${formatCop(item.parsed.y)}`
                  : ` Pedidos: ${item.parsed.y}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, color: '#78716C' }
          },
          y: {
            position: 'left',
            grid: { color: 'rgba(28, 25, 23, 0.06)' },
            ticks: {
              font: { size: 11 },
              color: '#15803D',
              callback: val => formatCop(Number(val))
            }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            ticks: { font: { size: 11 }, color: '#D9480F', stepSize: 1 }
          }
        }
      }
    });
  }
}
