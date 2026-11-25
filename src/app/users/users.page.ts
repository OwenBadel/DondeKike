import { Component, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { AlertService } from '../services/alert.service';
import { User, UserRole } from '../models/user.model';
import { CreateUserModalComponent } from './create-user-modal/create-user-modal.component';

@Component({
  selector: 'app-users',
  templateUrl: './users.page.html',
  styleUrls: ['./users.page.scss'],
  standalone: false
})
export class UsersPage implements OnInit {

  private authService = inject(AuthService);
  private modalCtrl = inject(ModalController);
  private alertService = inject(AlertService);

  users: User[] = [];
  roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Administrador' },
    { value: 'waiter', label: 'Mesero / Caja' },
    { value: 'kitchen', label: 'Cocina' }
  ];

  ngOnInit(): void {
    this.loadUsers();
  }

  ionViewWillEnter(): void {
    this.loadUsers();
  }

  async loadUsers(): Promise<void> {
    this.users = await this.authService.getAllUsers();
  }

  getInitials(fullName: string): string {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'DK';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  getRoleLabel(role: UserRole): string {
    return this.roles.find(r => r.value === role)?.label || role;
  }

  getRolePillClass(role: UserRole): string {
    switch (role) {
      case 'admin': return 'brand';
      case 'waiter': return 'info';
      case 'kitchen': return 'warning';
      default: return 'neutral';
    }
  }

  isDefaultAdmin(user: User): boolean {
    return user.id === 'usr_admin_default';
  }

  isCurrentUser(user: User): boolean {
    return this.authService.isCurrentUser(user.id);
  }

  isProtected(user: User): boolean {
    return this.isDefaultAdmin(user) || this.isCurrentUser(user);
  }

  async openCreateModal(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CreateUserModalComponent
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.created) {
      this.loadUsers();
    }
  }

  async confirmChangeRole(user: User): Promise<void> {
    if (this.isProtected(user)) {
      this.alertService.toast('No se puede cambiar el rol de esta cuenta protegida', 'warning');
      return;
    }

    const options: Record<string, string> = {
      admin: 'Administrador',
      waiter: 'Mesero / Caja',
      kitchen: 'Cocina'
    };

    const newRole = await this.alertService.select(
      `Rol para ${user.fullName}`,
      options,
      user.role,
      'Actualizar'
    );

    if (newRole && newRole !== user.role) {
      const result = await this.authService.updateUserRole(user.id, newRole as UserRole);
      this.alertService.toast(result.message, result.success ? 'success' : 'error');
      if (result.success) await this.loadUsers();
    }
  }

  async confirmDelete(user: User): Promise<void> {
    if (this.isProtected(user)) {
      this.alertService.toast('No se puede eliminar esta cuenta protegida', 'warning');
      return;
    }

    const confirmed = await this.alertService.confirm(
      '¿Eliminar usuario?',
      `¿Estás seguro de eliminar a "${user.fullName}"? Esta acción no se puede deshacer.`,
      'Sí, eliminar',
      'Cancelar',
      'warning'
    );

    if (confirmed) {
      const result = await this.authService.deleteUser(user.id);
      this.alertService.toast(result.message, result.success ? 'success' : 'error');
      if (result.success) await this.loadUsers();
    }
  }
}
