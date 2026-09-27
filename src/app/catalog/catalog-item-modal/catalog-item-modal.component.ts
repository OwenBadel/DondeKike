import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController, LoadingController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CatalogItem, CATALOG_CATEGORIES, InsumoRecipe } from '../../models/catalog.model';
import { CatalogService } from '../../services/catalog.service';
import { InventoryService } from '../../services/inventory.service';
import { AlertService } from '../../services/alert.service';
import { Insumo } from '../../models/product.model';

@Component({
  selector: 'app-catalog-item-modal',
  templateUrl: './catalog-item-modal.component.html',
  styleUrls: ['./catalog-item-modal.component.scss'],
  standalone: false
})
export class CatalogItemModalComponent implements OnInit, OnDestroy {

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() item?: CatalogItem;

  private fb = inject(FormBuilder);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);
  private alertService = inject(AlertService);
  private catalogService = inject(CatalogService);
  private inventoryService = inject(InventoryService);

  itemForm!: FormGroup;
  categories = CATALOG_CATEGORIES;
  imagePreview: string | null = null;
  selectedFile: File | null = null;
  uploading = false;

  availableInsumos: Insumo[] = [];
  recipe: InsumoRecipe[] = [];
  selectedInsumoId = '';
  selectedQuantity = 1;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.itemForm = this.fb.group({
      name: [this.item?.name || '', [Validators.required, Validators.minLength(2)]],
      content: [this.item?.content || '', [Validators.required]],
      price: [this.item?.price || 0, [Validators.required, Validators.min(0.01)]],
      category: [this.item?.category || 'Perros', [Validators.required]],
      image: [this.item?.image || '']
    });

    if (this.item?.image) {
      this.imagePreview = this.item.image;
    }

    if (this.item?.insumoRecipe) {
      this.recipe = [...this.item.insumoRecipe];
    }

    this.inventoryService.allInsumos$
      .pipe(takeUntil(this.destroy$))
      .subscribe(insumos => {
        this.availableInsumos = insumos;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result as string;
      };
      reader.readAsDataURL(this.selectedFile);
    }
  }

  removeImage(): void {
    this.itemForm.patchValue({ image: '' });
    this.imagePreview = null;
    this.selectedFile = null;
  }

  async save(): Promise<void> {
    if (!this.itemForm.valid) {
      this.itemForm.markAllAsTouched();
      return;
    }

    if (this.selectedFile) {
      const loading = await this.loadingCtrl.create({ message: 'Subiendo imagen...' });
      await loading.present();
      try {
        if (this.mode === 'edit' && this.item?.image) {
          await this.catalogService.deleteImage(this.item.image);
        }
        const publicUrl = await this.catalogService.uploadImage(this.selectedFile);
        this.itemForm.patchValue({ image: publicUrl });
      } catch {
        await loading.dismiss();
        this.alertService.toast('Error al subir imagen', 'error');
        return;
      }
      await loading.dismiss();
    }

    this.modalCtrl.dismiss({
      saved: true,
      item: { ...this.itemForm.value, insumoRecipe: this.recipe }
    });
  }

  cancel(): void {
    this.modalCtrl.dismiss({ saved: false });
  }

  getInsumoName(insumoId: string): string {
    const insumo = this.availableInsumos.find(i => i.id === insumoId);
    return insumo?.name || 'Desconocido';
  }

  addRecipeItem(): void {
    if (!this.selectedInsumoId || this.selectedQuantity < 1) return;
    const existing = this.recipe.find(r => r.insumoId === this.selectedInsumoId);
    if (existing) {
      existing.quantity = this.selectedQuantity;
    } else {
      this.recipe.push({ insumoId: this.selectedInsumoId, quantity: this.selectedQuantity });
    }
    this.selectedInsumoId = '';
    this.selectedQuantity = 1;
  }

  removeRecipeItem(index: number): void {
    this.recipe.splice(index, 1);
  }

  getError(field: string): string {
    const control = this.itemForm.get(field);
    if (!control?.touched || control.valid) return '';
    if (control.hasError('required')) return 'Campo requerido';
    if (control.hasError('min')) return `Valor mínimo: ${control.getError('min').min}`;
    if (control.hasError('minlength')) return `Mínimo ${control.getError('minlength').requiredLength} caracteres`;
    return '';
  }
}
