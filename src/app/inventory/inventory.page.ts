import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Insumo } from '../models/product.model';
import { InventoryService } from '../services/inventory.service';
import { AlertService } from '../services/alert.service';
import { ProductModalComponent } from './product-modal/product-modal.component';

@Component({
  selector: 'app-inventory',
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
  standalone: false
})
export class InventoryPage implements OnInit, OnDestroy {

  private inventoryService = inject(InventoryService);
  private alertService = inject(AlertService);
  private modalCtrl = inject(ModalController);

  insumos$!: Observable<Insumo[]>;
  lowStockInsumos$!: Observable<Insumo[]>;
  allInsumos: Insumo[] = [];
  filteredInsumos: Insumo[] = [];
  searchTerm = '';

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.insumos$ = this.inventoryService.allInsumos$;
    this.lowStockInsumos$ = this.inventoryService.lowStockInsumos$;

    this.insumos$.pipe(takeUntil(this.destroy$)).subscribe(insumos => {
      this.allInsumos = insumos;
      this.applyFilters();
    });
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
      await this.inventoryService.addInsumo(data.insumo);
      this.alertService.toast(`Insumo "${data.insumo.name}" agregado`, 'success');
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
      await this.inventoryService.updateInsumo(insumo.id, data.insumo);
      this.alertService.toast(`Insumo actualizado`, 'success');
    }
  }

  async confirmDelete(insumo: Insumo): Promise<void> {
    const confirmed = await this.alertService.confirm(
      '¿Eliminar Insumo?',
      `¿Está seguro de eliminar "${insumo.name}"? Esta acción no se puede deshacer.`,
      'Sí, eliminar',
      'Cancelar'
    );
    if (confirmed) {
      await this.inventoryService.deleteInsumo(insumo.id);
      this.alertService.toast(`Insumo eliminado`, 'info');
    }
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  isLowStock(insumo: Insumo): boolean {
    return insumo.stock <= insumo.lowStockThreshold;
  }

  getStockColor(insumo: Insumo): string {
    if (insumo.stock === 0) return 'danger';
    if (insumo.stock <= insumo.lowStockThreshold) return 'warning';
    return 'success';
  }

  private applyFilters(): void {
    if (!this.searchTerm) {
      this.filteredInsumos = [...this.allInsumos];
      return;
    }
    this.filteredInsumos = this.allInsumos.filter(i =>
      i.name.toLowerCase().includes(this.searchTerm)
    );
  }
}
