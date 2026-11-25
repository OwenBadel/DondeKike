import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AlertService } from '../../services/alert.service';
import { HapticsService } from '../../services/haptics.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit, OnDestroy {

  private authService = inject(AuthService);
  private router = inject(Router);
  private alertService = inject(AlertService);
  private haptics = inject(HapticsService);

  username = '';
  pin = '';
  pinDots = [false, false, false, false];
  showError = false;
  errorMessage = '';
  isLoading = false;
  shakeDots = false;
  quickUsers: User[] = [];

  numpadKeys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['clear', '0', 'del']
  ];

  private isViewActive = true;
  private autoLoginTimer: ReturnType<typeof setTimeout> | null = null;
  private shakeTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    this.resetForm();
    await this.authService.waitUntilReady();
    if (this.authService.isLoggedIn) {
      this.router.navigate(['/dashboard'], { replaceUrl: true });
      return;
    }
    await this.loadQuickUsers();
  }

  async ionViewWillEnter(): Promise<void> {
    this.isViewActive = true;
    await this.authService.waitUntilReady();
    if (this.authService.isLoggedIn) {
      this.router.navigate(['/dashboard'], { replaceUrl: true });
      return;
    }
    this.resetForm();
    await this.loadQuickUsers();
  }

  async loadQuickUsers(): Promise<void> {
    try {
      this.quickUsers = await this.authService.getAllUsers();
    } catch {
      this.quickUsers = [];
    }
  }

  selectQuickUser(user: User): void {
    this.username = user.username;
    this.showError = false;
    this.haptics.tap();
  }

  ionViewWillLeave(): void {
    this.isViewActive = false;
    this.clearTimers();
  }

  ngOnDestroy(): void {
    this.isViewActive = false;
    this.clearTimers();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    if (!this.isViewActive || this.isLoading) return;
    const active = document.activeElement as HTMLElement | null;
    const isTypingInput = active?.tagName === 'INPUT' || active?.tagName === 'ION-INPUT';

    if (isTypingInput) {
      if (event.key === 'Enter') {
        active?.blur();
      }
      return;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      this.onKeyPress(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.onKeyPress('del');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.onKeyPress('clear');
    } else if (event.key === 'Enter' && this.pin.length === 4) {
      event.preventDefault();
      this.clearAutoLoginTimer();
      this.onLogin();
    }
  }

  private resetForm(): void {
    this.clearTimers();
    this.username = '';
    this.pin = '';
    this.pinDots = [false, false, false, false];
    this.showError = false;
    this.errorMessage = '';
    this.isLoading = false;
    this.shakeDots = false;
  }

  onKeyPress(key: string): void {
    if (!key || this.isLoading) return;
    this.showError = false;
    this.haptics.tap();

    if (key === 'clear') {
      this.clearPin();
      return;
    }

    if (key === 'del') {
      if (this.pin.length > 0) {
        this.pin = this.pin.slice(0, -1);
      }
    } else if (this.pin.length < 4) {
      this.pin += key;
    }

    this.updateDots();

    if (this.pin.length === 4) {
      this.clearAutoLoginTimer();
      this.autoLoginTimer = setTimeout(() => this.onLogin(), 150);
    }
  }

  async onLogin(): Promise<void> {
    this.clearAutoLoginTimer();
    if (this.isLoading) return;

    if (!this.username.trim()) {
      this.triggerError('Ingresa tu nombre de usuario primero');
      this.clearPin();
      return;
    }

    if (this.pin.length !== 4) {
      this.triggerError('El PIN debe contener 4 dígitos');
      return;
    }

    this.isLoading = true;

    const result = await this.authService.login({
      username: this.username.trim(),
      pin: this.pin
    });

    this.isLoading = false;

    if (result.success) {
      this.haptics.success();
      this.alertService.toast(result.message, 'success');
      this.router.navigate(['/dashboard'], { replaceUrl: true });
    } else {
      this.haptics.warning();
      this.triggerError(result.message);
      this.clearPin();
    }
  }

  clearPin(): void {
    this.clearAutoLoginTimer();
    this.pin = '';
    this.updateDots();
  }

  private triggerError(message: string): void {
    this.showError = true;
    this.errorMessage = message;
    this.shakeDots = true;
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.shakeTimer = setTimeout(() => (this.shakeDots = false), 380);
  }

  private updateDots(): void {
    this.pinDots = [false, false, false, false].map((_, i) => i < this.pin.length);
  }

  private clearAutoLoginTimer(): void {
    if (this.autoLoginTimer) {
      clearTimeout(this.autoLoginTimer);
      this.autoLoginTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearAutoLoginTimer();
    if (this.shakeTimer) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
  }
}
