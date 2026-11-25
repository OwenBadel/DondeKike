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
import { trimmedMinLength, trimmedRequired, validateImageFile } from '../../utils/form-validators.util';

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

  availableInsumos: Insumo[] = [];
  recipe: InsumoRecipe[] = [];
  selectedInsumoId = '';
  selectedQuantity = 1;

  private originalImageUrl = '';
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.originalImageUrl = this.item?.image ?? '';

    this.itemForm = this.fb.group({
      name: [this.item?.name ?? '', [trimmedRequired(), trimmedMinLength(2), Validators.maxLength(80)]],
      content: [this.item?.content ?? '', [trimmedRequired(), Validators.maxLength(240)]],
      price: [this.item?.price ?? null, [Validators.required, Validators.min(100)]],
      category: [this.item?.category ?? 'Perros', [Validators.required]],
      image: [this.originalImageUrl]
    });

    if (this.originalImageUrl) {
      this.imagePreview = this.originalImageUrl;
    }

    if (this.item?.insumoRecipe) {
      this.recipe = this.item.insumoRecipe.map(r => ({ ...r }));
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
    const file = input.files?.[0];
    if (!file) return;

    const check = validateImageFile(file);
    if (!check.valid) {
      this.alertService.toast(check.message || 'Imagen no válida', 'warning');
      input.value = '';
      return;
    }

    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.imagePreview = reader.result as string;
    };
    reader.readAsDataURL(this.selectedFile);
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

    let newlyUploadedUrl = '';

    if (this.selectedFile) {
      const loading = await this.loadingCtrl.create({ message: 'Subiendo imagen...' });
      await loading.present();
      try {
        newlyUploadedUrl = await this.catalogService.uploadImage(this.selectedFile);
        this.itemForm.patchValue({ image: newlyUploadedUrl });
      } catch (err: any) {
        await loading.dismiss();
        this.alertService.toast(err?.message || 'Error al subir imagen', 'error');
        return;
      }
      await loading.dismiss();
    }

    const rawVal = this.itemForm.value;
    const currentImage = rawVal.image || '';
    const oldImageToDelete =
      this.mode === 'edit' && this.originalImageUrl && this.originalImageUrl !== currentImage
        ? this.originalImageUrl
        : '';

    this.modalCtrl.dismiss({
      saved: true,
      oldImageToDelete,
      newlyUploadedUrl,
      item: {
        ...rawVal,
        name: String(rawVal.name || '').trim(),
        content: String(rawVal.content || '').trim(),
        price: Math.round(Number(rawVal.price) || 0),
        insumoRecipe: this.recipe
      }
    });
  }

  cancel(): void {
    this.modalCtrl.dismiss({ saved: false });
  }

  getInsumoName(insumoId: string): string {
    const insumo = this.availableInsumos.find(i => i.id === insumoId);
    return insumo?.name || 'Insumo eliminado';
  }

  addRecipeItem(): void {
    const qty = Math.floor(Number(this.selectedQuantity) || 0);
    if (!this.selectedInsumoId || qty < 1) return;

    const existing = this.recipe.find(r => r.insumoId === this.selectedInsumoId);
    if (existing) {
      existing.quantity = qty;
    } else {
      this.recipe.push({ insumoId: this.selectedInsumoId, quantity: qty });
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
    if (control.hasError('min')) return `Valor mínimo: $${control.getError('min').min}`;
    if (control.hasError('minlength')) return `Mínimo ${control.getError('minlength').requiredLength} caracteres`;
    if (control.hasError('maxlength')) return `Máximo ${control.getError('maxlength').requiredLength} caracteres`;
    return '';
  }
}
