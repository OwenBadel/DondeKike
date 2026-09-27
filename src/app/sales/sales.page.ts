import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { OrderService } from '../services/order.service';
import { Order } from '../models/order.model';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-sales',
  templateUrl: './sales.page.html',
  styleUrls: ['./sales.page.scss'],
  standalone: false
})
export class SalesPage implements OnInit, OnDestroy {

  @ViewChild('salesChart') salesChartRef!: ElementRef<HTMLCanvasElement>;

  private orderService = inject(OrderService);

  selectedDate: Date = new Date();
  dayOrders$!: Observable<Order[]>;
  dayRevenue$!: Observable<number>;
  cashSummary$!: Observable<{
    totalSales: number;
    orderCount: number;
    efectivo: number;
    transferencia: number;
  }>;
  salesSummary$!: Observable<{ date: string; count: number; total: number }[]>;

  private chart: Chart | null = null;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadDay();
    this.salesSummary$ = this.orderService.getSalesSummaryByDay();

    this.salesSummary$
      .pipe(takeUntil(this.destroy$))
      .subscribe(summary => {
        if (summary && summary.length > 0) {
          this.buildChart(summary);
        }
      });
  }

  ionViewWillEnter(): void {
    this.orderService.refresh();
    this.loadDay();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  loadDay(): void {
    this.dayOrders$ = this.orderService.getOrdersByDate(this.selectedDate);
    this.dayRevenue$ = this.orderService.getRevenueByDate(this.selectedDate);
    this.cashSummary$ = this.orderService.getCashRegisterSummary(this.selectedDate);
  }

  private buildChart(summary: { date: string; count: number; total: number }[]): void {
    if (!this.salesChartRef) return;

    const data = [...summary].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

    const labels = data.map(d => {
      const date = new Date(d.date + 'T12:00:00');
      const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      return `${days[date.getDay()]} ${date.getDate()}`;
    });
    const revenues = data.map(d => d.total);
    const counts = data.map(d => d.count);

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const ctx = this.salesChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ventas ($)',
            data: revenues,
            borderColor: '#2dd36f',
            backgroundColor: 'rgba(45, 211, 111, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#2dd36f',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            yAxisID: 'y'
          },
          {
            label: 'Pedidos',
            data: counts,
            borderColor: '#3880ff',
            backgroundColor: 'rgba(56, 128, 255, 0.08)',
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#3880ff',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderDash: [6, 3],
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 12, weight: 'bold' }
            }
          },
          tooltip: {
            backgroundColor: '#1a1a2e',
            titleFont: { size: 13 },
            bodyFont: { size: 12 },
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (ctx: any) => {
                if (ctx.datasetIndex === 0) {
                  return ` Ventas: $${ctx.parsed.y.toLocaleString()}`;
                }
                return ` Pedidos: ${ctx.parsed.y}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, color: '#888' }
          },
          y: {
            position: 'left',
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              color: '#2dd36f',
              callback: (val) => '$' + Number(val).toLocaleString()
            }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            ticks: {
              font: { size: 11 },
              color: '#3880ff',
              stepSize: 1
            }
          }
        }
      }
    });
  }

  previousDay(): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() - 1);
    this.selectedDate = d;
    this.loadDay();
  }

  nextDay(): void {
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
}
