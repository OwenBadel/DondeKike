import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Insumo } from '../models/product.model';
import { InventoryService } from '../services/inventory.service';
import { CatalogService } from '../services/catalog.service';
import { AlertService } from '../services/alert.service';
import { HapticsService } from '../services/haptics.service';
import { ProductModalComponent } from './product-modal/product-modal.component';

type StockFilter = 'all' | 'low' | 'out';

@Component({
  selector: 'app-inventory',
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
  standalone: false
})
export class InventoryPage implements OnInit, OnDestroy {

  private inventoryService = inject(InventoryService);
  private catalogService = inject(CatalogService);
  private alertService = inject(AlertService);
  private haptics = inject(HapticsService);
  private modalCtrl = inject(ModalController);

  allInsumos: Insumo[] = [];
  filteredInsumos: Insumo[] = [];
  searchTerm = '';
  stockFilter: StockFilter = 'all';
  updatingId: string | null = null;

  private destroy$ = new Subject<void>();

  get lowStockCount(): number {
    return this.allInsumos.filter(i => i.stock > 0 && i.stock <= i.lowStockThreshold).length;
  }

  get outOfStockCount(): number {
    return this.allInsumos.filter(i => i.stock === 0).length;
  }

  ngOnInit(): void {
    this.inventoryService.allInsumos$
      .pipe(takeUntil(this.destroy$))
      .subscribe(insumos => {
        this.allInsumos = insumos;
        this.applyFilters();
      });
  }

  ionViewWillEnter(): void {
    this.inventoryService.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async openAddModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ProductModalComponent,
      componentProps: { mode: 'create' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.saved) {
      const created = await this.inventoryService.addInsumo(data.insumo);
      if (created) {
        this.alertService.toast(`Insumo "${data.insumo.name}" agregado`, 'success');
      } else {
        this.alertService.modal('Error', 'No se pudo registrar el insumo.', 'error');
      }
    }
  }

  async openEditModal(insumo: Insumo): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ProductModalComponent,
      componentProps: { mode: 'edit', insumo }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.saved) {
      const updated = await this.inventoryService.updateInsumo(insumo.id, data.insumo);
      if (updated) {
        this.alertService.toast('Insumo actualizado', 'success');
      } else {
        this.alertService.modal('Error', 'No se pudo actualizar el insumo.', 'error');
      }
    }
  }

  async quickAdjust(insumo: Insumo, delta: number): Promise<void> {
    if (this.updatingId) return;
    if (delta < 0 && insumo.stock <= 0) return;

    this.updatingId = insumo.id;
    const updated = await this.inventoryService.adjustStock(insumo.id, delta);
    this.updatingId = null;

    if (updated) {
      this.haptics.tap();
      const sign = delta > 0 ? `+${delta}` : `${delta}`;
      this.alertService.toast(`${insumo.name}: ${sign} (Stock: ${updated.stock})`, 'success');
    } else {
      this.alertService.toast('No se pudo ajustar el stock', 'error');
    }
  }

  async confirmDelete(insumo: Insumo): Promise<void> {
    const linkedDishes = this.catalogService.getItemsUsingInsumo(insumo.id);
    if (linkedDishes.length > 0) {
      const names = linkedDishes.map(d => d.name).join(', ');
      await this.alertService.modal(
        'Insumo en uso',
        `No puedes eliminar "${insumo.name}" porque forma parte de la receta de: ${names}. Retíralo primero del catálogo.`,
        'warning'
      );
      return;
    }

    const confirmed = await this.alertService.confirm(
      '¿Eliminar insumo?',
      `¿Estás seguro de eliminar "${insumo.name}"? Esta acción no se puede deshacer.`,
      'Sí, eliminar',
      'Cancelar'
    );
    if (!confirmed) return;

    const ok = await this.inventoryService.deleteInsumo(insumo.id);
    if (ok) {
      this.alertService.toast('Insumo eliminado', 'info');
    } else {
      this.alertService.modal('Error', 'No se pudo eliminar el insumo.', 'error');
    }
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  setFilter(filter: StockFilter): void {
    this.stockFilter = filter;
    this.applyFilters();
  }

  isLowStock(insumo: Insumo): boolean {
    return insumo.stock <= insumo.lowStockThreshold;
  }

  getStockStatusClass(insumo: Insumo): string {
    if (insumo.stock === 0) return 'danger';
    if (insumo.stock <= insumo.lowStockThreshold) return 'warning';
    return 'success';
  }

  getStockStatusLabel(insumo: Insumo): string {
    if (insumo.stock === 0) return 'Agotado';
    if (insumo.stock <= insumo.lowStockThreshold) return 'Stock bajo';
    return 'Óptimo';
  }

  private applyFilters(): void {
    let list = [...this.allInsumos];

    if (this.stockFilter === 'low') {
      list = list.filter(i => i.stock > 0 && i.stock <= i.lowStockThreshold);
    } else if (this.stockFilter === 'out') {
      list = list.filter(i => i.stock === 0);
    }

    if (this.searchTerm) {
      list = list.filter(i => i.name.toLowerCase().includes(this.searchTerm));
    }

    this.filteredInsumos = list;
  }
}
