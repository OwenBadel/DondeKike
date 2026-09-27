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
    { value: 'waiter', label: 'Mesero' },
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

  getRoleLabel(role: UserRole): string {
    return this.roles.find(r => r.value === role)?.label || role;
  }

  getRoleColor(role: UserRole): string {
    switch (role) {
      case 'admin': return 'danger';
      case 'waiter': return 'primary';
      case 'kitchen': return 'warning';
      default: return 'medium';
    }
  }

  getRoleIcon(role: UserRole): string {
    switch (role) {
      case 'admin': return 'shield-outline';
      case 'waiter': return 'people-outline';
      case 'kitchen': return 'restaurant-outline';
      default: return 'person-outline';
    }
  }

  getUserIcon(role: UserRole): string {
    switch (role) {
      case 'admin': return 'person-circle';
      case 'waiter': return 'person-circle-outline';
      case 'kitchen': return 'person-circle-outline';
      default: return 'person-circle-outline';
    }
  }

  isDefaultAdmin(user: User): boolean {
    return user.id === 'usr_admin_default';
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
    if (this.isDefaultAdmin(user)) {
      this.alertService.toast('No se puede cambiar el rol del administrador por defecto', 'warning');
      return;
    }

    const options: Record<string, string> = {
      admin: 'Administrador',
      waiter: 'Mesero',
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
    if (this.isDefaultAdmin(user)) {
      this.alertService.toast('No se puede eliminar el administrador por defecto', 'warning');
      return;
    }

    const confirmed = await this.alertService.confirm(
      '¿Eliminar Usuario?',
      `¿Está seguro de eliminar a "${user.fullName}"? Esta acción no se puede deshacer.`,
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
