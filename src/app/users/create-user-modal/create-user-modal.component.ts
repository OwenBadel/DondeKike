import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { AlertService } from '../../services/alert.service';
import { UserRole } from '../../models/user.model';

@Component({
  selector: 'app-create-user-modal',
  templateUrl: './create-user-modal.component.html',
  styleUrls: ['./create-user-modal.component.scss'],
  standalone: false
})
export class CreateUserModalComponent implements OnInit {

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private modalCtrl = inject(ModalController);
  private alertService = inject(AlertService);

  registerForm!: FormGroup;
  pin = '';
  pinDots = [false, false, false, false];

  roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Administrador' },
    { value: 'waiter', label: 'Mesero' },
    { value: 'kitchen', label: 'Cocina' }
  ];

  numpadKeys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'del']
  ];

  ngOnInit(): void {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(3)]],
      username: ['', [Validators.required, Validators.minLength(3)]],
      role: ['waiter', [Validators.required]]
    });
  }

  onKeyPress(key: string): void {
    if (key === '') return;

    if (key === 'del') {
      if (this.pin.length > 0) {
        this.pin = this.pin.slice(0, -1);
      }
    } else if (this.pin.length < 4) {
      this.pin += key;
    }

    this.updateDots();
  }

  async onRegister(): Promise<void> {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    if (this.pin.length !== 4) {
      this.alertService.toast('El PIN debe ser de 4 dígitos', 'warning');
      return;
    }

    const formValue = this.registerForm.value;

    const result = await this.authService.register({
      fullName: formValue.fullName,
      username: formValue.username,
      pin: this.pin,
      role: formValue.role
    });

    this.alertService.toast(result.message, result.success ? 'success' : 'error');

    if (result.success) {
      this.modalCtrl.dismiss({ created: true });
    }
  }

  cancel(): void {
    this.modalCtrl.dismiss({ created: false });
  }

  clearPin(): void {
    this.pin = '';
    this.updateDots();
  }

  private updateDots(): void {
    this.pinDots = [false, false, false, false].map((_, i) => i < this.pin.length);
  }

  getError(field: string): string {
    const control = this.registerForm.get(field);
    if (!control?.touched || control.valid) return '';

    if (control.hasError('required')) return 'Campo requerido';
    if (control.hasError('minlength')) {
      const min = control.getError('minlength').requiredLength;
      return `Mínimo ${min} caracteres`;
    }
    return '';
  }
}
