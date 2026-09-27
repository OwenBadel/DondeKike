import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AlertService } from '../../services/alert.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit {

  private authService = inject(AuthService);
  private router = inject(Router);
  private alertService = inject(AlertService);

  username = '';
  pin = '';
  pinDots = [false, false, false, false];
  showError = false;
  errorMessage = '';
  isLoading = false;

  numpadKeys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'del']
  ];

  ngOnInit(): void {
    this.resetForm();
    if (this.authService.isLoggedIn) {
      this.router.navigate(['/dashboard']);
    }
  }

  ionViewWillEnter(): void {
    this.resetForm();
  }

  private resetForm(): void {
    this.username = '';
    this.pin = '';
    this.pinDots = [false, false, false, false];
    this.showError = false;
    this.errorMessage = '';
  }

  onKeyPress(key: string): void {
    if (key === '') return;
    this.showError = false;

    if (key === 'del') {
      if (this.pin.length > 0) {
        this.pin = this.pin.slice(0, -1);
      }
    } else if (this.pin.length < 4) {
      this.pin += key;
    }

    this.updateDots();

    if (this.pin.length === 4) {
      setTimeout(() => this.onLogin(), 200);
    }
  }

  async onLogin(): Promise<void> {
    if (!this.username.trim()) {
      this.showError = true;
      this.errorMessage = 'Ingresa tu nombre de usuario';
      return;
    }

    if (this.pin.length !== 4) {
      this.showError = true;
      this.errorMessage = 'El PIN debe ser de 4 dígitos';
      return;
    }

    this.isLoading = true;

    const result = await this.authService.login({
      username: this.username.trim(),
      pin: this.pin
    });

    this.isLoading = false;

    if (result.success) {
      this.alertService.toast(result.message, 'success');
      this.router.navigate(['/dashboard']);
    } else {
      this.showError = true;
      this.errorMessage = result.message;
      this.clearPin();
    }
  }

  clearPin(): void {
    this.pin = '';
    this.updateDots();
  }

  private updateDots(): void {
    this.pinDots = [false, false, false, false].map((_, i) => i < this.pin.length);
  }
}
