import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CatalogItem, CATALOG_CATEGORIES } from '../models/catalog.model';
import { CatalogService } from '../services/catalog.service';
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
  private alertService = inject(AlertService);
  private modalCtrl = inject(ModalController);

  items$!: Observable<CatalogItem[]>;
  allItems: CatalogItem[] = [];
  filteredItems: CatalogItem[] = [];
  searchTerm = '';
  selectedCategory = '';
  categories = CATALOG_CATEGORIES;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.items$ = this.catalogService.allItems$;

    this.items$.pipe(takeUntil(this.destroy$)).subscribe(items => {
      this.allItems = items;
      this.applyFilters();
    });
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
      await this.catalogService.addItem(data.item);
      this.alertService.toast(`"${data.item.name}" agregado al menú`, 'success');
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
      await this.catalogService.updateItem(item.id, data.item);
      this.alertService.toast(`Producto actualizado`, 'success');
    }
  }

  async confirmDelete(item: CatalogItem): Promise<void> {
    const confirmed = await this.alertService.confirm(
      '¿Eliminar del Menú?',
      `¿Desea eliminar "${item.name}" del catálogo?`,
      'Sí, eliminar',
      'Cancelar'
    );
    if (confirmed) {
      await this.catalogService.deleteItem(item.id);
      this.alertService.toast(`Producto eliminado`, 'info');
    }
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLIonSearchbarElement;
    this.searchTerm = target.value?.toLowerCase().trim() || '';
    this.applyFilters();
  }

  onCategoryFilter(event: any): void {
    this.selectedCategory = event.detail.value || '';
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
