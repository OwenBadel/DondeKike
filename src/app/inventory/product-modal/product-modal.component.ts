import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController } from '@ionic/angular';
import { Insumo } from '../../models/product.model';
import { trimmedMinLength, trimmedRequired } from '../../utils/form-validators.util';

@Component({
  selector: 'app-product-modal',
  templateUrl: './product-modal.component.html',
  styleUrls: ['./product-modal.component.scss'],
  standalone: false
})
export class ProductModalComponent implements OnInit {

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() insumo?: Insumo;

  private fb = inject(FormBuilder);
  private modalCtrl = inject(ModalController);

  insumoForm!: FormGroup;

  ngOnInit(): void {
    this.insumoForm = this.fb.group({
      name: [this.insumo?.name ?? '', [trimmedRequired(), trimmedMinLength(2), Validators.maxLength(80)]],
      stock: [this.insumo?.stock ?? 0, [Validators.required, Validators.min(0)]],
      lowStockThreshold: [this.insumo?.lowStockThreshold ?? 5, [Validators.required, Validators.min(0)]]
    });
  }

  save(): void {
    if (this.insumoForm.valid) {
      const val = this.insumoForm.value;
      this.modalCtrl.dismiss({
        saved: true,
        insumo: {
          name: String(val.name || '').trim(),
          stock: Math.max(0, Math.round(Number(val.stock) || 0)),
          lowStockThreshold: Math.max(0, Math.round(Number(val.lowStockThreshold) || 0)),
          image: this.insumo?.image ?? ''
        }
      });
    } else {
      this.insumoForm.markAllAsTouched();
    }
  }

  cancel(): void {
    this.modalCtrl.dismiss({ saved: false });
  }

  getError(field: string): string {
    const control = this.insumoForm.get(field);
    if (!control?.touched || control.valid) return '';
    if (control.hasError('required')) return 'Campo requerido';
    if (control.hasError('min')) return `Valor mínimo: ${control.getError('min').min}`;
    if (control.hasError('minlength')) return `Mínimo ${control.getError('minlength').requiredLength} caracteres`;
    return '';
  }
}
