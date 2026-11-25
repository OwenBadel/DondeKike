import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CatalogItem, CATALOG_CATEGORIES } from '../models/catalog.model';
import { CatalogService } from '../services/catalog.service';
import { InventoryService } from '../services/inventory.service';
import { AlertService } from '../services/alert.service';
import { CatalogItemModalComponent } from './catalog-item-modal/catalog-item-modal.component';

@Component({
  selector: 'app-catalog',
  templateUrl: './catalog.page.html',
  styleUrls: ['./catalog.page.scss'],
  standalone: false
})
export class CatalogPage implements OnInit, OnDestroy {

  private catalogService = inject(CatalogService);
  private inventoryService = inject(InventoryService);
  private alertService = inject(AlertService);
  private modalCtrl = inject(ModalController);

  allItems: CatalogItem[] = [];
  filteredItems: CatalogItem[] = [];
  searchTerm = '';
  selectedCategory = '';
  categories = CATALOG_CATEGORIES;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.catalogService.allItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.allItems = items;
        this.applyFilters();
      });
  }

  ionViewWillEnter(): void {
    this.catalogService.refresh();
    this.inventoryService.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async openAddModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CatalogItemModalComponent,
      componentProps: { mode: 'create' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.saved) {
      const created = await this.catalogService.addItem(data.item);
      if (created) {
        this.alertService.toast(`"${data.item.name}" agregado al menú`, 'success');
      } else {
        if (data.newlyUploadedUrl) {
          await this.catalogService.deleteImage(data.newlyUploadedUrl);
        }
        this.alertService.modal('Error', 'No se pudo agregar el producto al catálogo.', 'error');
      }
    }
  }

  async openEditModal(item: CatalogItem): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CatalogItemModalComponent,
      componentProps: { mode: 'edit', item }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.saved) {
      const updated = await this.catalogService.updateItem(item.id, data.item);
      if (updated) {
        if (data.oldImageToDelete) {
          await this.catalogService.deleteImage(data.oldImageToDelete);
        }
        this.alertService.toast('Producto actualizado', 'success');
      } else {
        if (data.newlyUploadedUrl) {
          await this.catalogService.deleteImage(data.newlyUploadedUrl);
        }
        this.alertService.modal('Error', 'No se pudo actualizar el producto.', 'error');
      }
    }
  }

  async confirmDelete(item: CatalogItem): Promise<void> {
    const confirmed = await this.alertService.confirm(
      '¿Eliminar del menú?',
      `¿Deseas eliminar "${item.name}" del catálogo?`,
      'Sí, eliminar',
      'Cancelar'
    );
    if (!confirmed) return;

    const deleted = await this.catalogService.deleteItem(item.id);
    if (deleted) {
      this.alertService.toast('Producto eliminado', 'info');
    } else {
      this.alertService.modal('Error', 'No se pudo eliminar el producto.', 'error');
    }
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  setCategory(cat: string): void {
    this.selectedCategory = this.selectedCategory === cat ? '' : cat;
    this.applyFilters();
  }

  private applyFilters(): void {
    let filtered = [...this.allItems];

    if (this.searchTerm) {
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(this.searchTerm) ||
        i.content.toLowerCase().includes(this.searchTerm)
      );
    }

    if (this.selectedCategory) {
      filtered = filtered.filter(i => i.category === this.selectedCategory);
    }

    this.filteredItems = filtered;
  }
}
