import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController } from '@ionic/angular';
import { Insumo } from '../../models/product.model';

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
      name: [this.insumo?.name || '', [Validators.required, Validators.minLength(2)]],
      stock: [this.insumo?.stock || 0, [Validators.required, Validators.min(0)]],
      lowStockThreshold: [this.insumo?.lowStockThreshold || 10, [Validators.required, Validators.min(0)]]
    });
  }

  save(): void {
    if (this.insumoForm.valid) {
      this.modalCtrl.dismiss({
        saved: true,
        insumo: this.insumoForm.value
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
