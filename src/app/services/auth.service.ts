import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { User, AuthToken, LoginCredentials, RegisterData, UserRole } from '../models/user.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private sb = inject(SupabaseService);

  private currentUser$ = new BehaviorSubject<User | null>(null);
  private isAuthenticated$ = new BehaviorSubject<boolean>(false);

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    await this.ensureDefaultAdmin();
    await this.loadSession();
  }

  get user$(): Observable<User | null> {
    return this.currentUser$.asObservable();
  }

  get authenticated$(): Observable<boolean> {
    return this.isAuthenticated$.asObservable();
  }

  get currentUser(): User | null {
    return this.currentUser$.value;
  }

  get isLoggedIn(): boolean {
    return this.isAuthenticated$.value;
  }

  get userRole(): UserRole | null {
    return this.currentUser$.value?.role ?? null;
  }

  async login(credentials: LoginCredentials): Promise<{ success: boolean; message: string }> {
    try {
      // 1. Intentar verificación segura vía RPC en PostgreSQL (hash bcrypt)
      const { data: rpcData, error: rpcError } = await this.sb.client.rpc('verify_user_pin', {
        p_username: credentials.username.trim(),
        p_pin: credentials.pin.trim()
      });

      if (!rpcError && rpcData) {
        if (rpcData.success && rpcData.user) {
          const user: User = {
            id: rpcData.user.id,
            username: rpcData.user.username,
            fullName: rpcData.user.fullName,
            role: rpcData.user.role as UserRole,
            createdAt: new Date(rpcData.user.createdAt)
          };
          this.saveSession(user);
          return { success: true, message: 'Inicio de sesión exitoso.' };
        }
        return { success: false, message: rpcData.message || 'Credenciales incorrectas.' };
      }

      // 2. Fallback de transición para compatibilidad previa
      const { data, error } = await this.sb.client
        .from('users')
        .select('*')
        .ilike('username', credentials.username.trim())
        .maybeSingle();

      if (error || !data) {
        return { success: false, message: 'Usuario no encontrado.' };
      }

      if (data.pin !== credentials.pin) {
        return { success: false, message: 'PIN incorrecto.' };
      }

      const user = this.mapRow(data);
      this.saveSession(user);

      return { success: true, message: 'Inicio de sesión exitoso.' };
    } catch (err: any) {
      return { success: false, message: 'Error de conexión al iniciar sesión.' };
    }
  }

  async register(data: RegisterData): Promise<{ success: boolean; message: string }> {
    try {
      const newId = this.generateId();

      // 1. Intentar creación segura mediante RPC (con pgcrypto)
      const { data: rpcData, error: rpcError } = await this.sb.client.rpc('create_user_secure', {
        p_id: newId,
        p_username: data.username.trim(),
        p_full_name: data.fullName.trim(),
        p_role: data.role,
        p_pin: data.pin.trim()
      });

      if (!rpcError && rpcData) {
        return {
          success: rpcData.success,
          message: rpcData.message
        };
      }

      // 2. Fallback
      const { data: existing } = await this.sb.client
        .from('users')
        .select('id')
        .ilike('username', data.username)
        .maybeSingle();

      if (existing) {
        return { success: false, message: 'El nombre de usuario ya existe.' };
      }

      const newUser = {
        id: newId,
        username: data.username.trim(),
        full_name: data.fullName.trim(),
        role: data.role,
        pin: data.pin.trim()
      };

      const { error } = await this.sb.client.from('users').insert(newUser);

      if (error) {
        return { success: false, message: 'Error al registrar usuario: ' + error.message };
      }

      return { success: true, message: 'Usuario registrado exitosamente.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Error al registrar usuario.' };
    }
  }

  logout(): void {
    localStorage.removeItem('auth_token');
    this.currentUser$.next(null);
    this.isAuthenticated$.next(false);
  }

  hasRole(role: UserRole): Observable<boolean> {
    return this.currentUser$.pipe(
      map(user => user?.role === role)
    );
  }

  async getAllUsers(): Promise<User[]> {
    const { data, error } = await this.sb.client
      .from('users')
      .select('id, username, full_name, role, created_at')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map((r: any) => this.mapRow(r));
  }

  async updateUserRole(userId: string, newRole: UserRole): Promise<{ success: boolean; message: string }> {
    if (userId === 'usr_admin_default') {
      return { success: false, message: 'No se puede cambiar el rol del administrador por defecto.' };
    }

    const { error } = await this.sb.client
      .from('users')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      return { success: false, message: 'Error al actualizar rol.' };
    }
    return { success: true, message: 'Rol actualizado exitosamente.' };
  }

  async deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
    if (userId === 'usr_admin_default') {
      return { success: false, message: 'No se puede eliminar el administrador por defecto.' };
    }

    const { error } = await this.sb.client
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      return { success: false, message: 'Error al eliminar usuario.' };
    }
    return { success: true, message: 'Usuario eliminado exitosamente.' };
  }

  private saveSession(user: User): void {
    const token: AuthToken = {
      token: 'session_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
      userId: user.id,
      role: user.role,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000)
    };
    localStorage.setItem('auth_token', JSON.stringify(token));
    this.currentUser$.next(user);
    this.isAuthenticated$.next(true);
  }

  private async loadSession(): Promise<void> {
    const raw = localStorage.getItem('auth_token');
    if (!raw) return;

    try {
      const token: AuthToken = JSON.parse(raw);
      if (token.expiresAt <= Date.now()) {
        localStorage.removeItem('auth_token');
        return;
      }

      const { data } = await this.sb.client
        .from('users')
        .select('id, username, full_name, role, created_at')
        .eq('id', token.userId)
        .maybeSingle();

      if (data) {
        this.currentUser$.next(this.mapRow(data));
        this.isAuthenticated$.next(true);
      } else {
        localStorage.removeItem('auth_token');
      }
    } catch {
      localStorage.removeItem('auth_token');
    }
  }

  private async ensureDefaultAdmin(): Promise<void> {
    const { data } = await this.sb.client
      .from('users')
      .select('id')
      .eq('id', 'usr_admin_default')
      .maybeSingle();

    if (!data) {
      await this.register({
        username: 'Admin',
        fullName: 'Administrador',
        role: 'admin',
        pin: '1927'
      });
    }
  }

  private mapRow(row: any): User {
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at)
    };
  }

  private generateId(): string {
    const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).substring(2, 12);
    return 'usr_' + randomPart;
  }
}
