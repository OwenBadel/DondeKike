import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User, AuthToken, LoginCredentials, RegisterData, UserRole } from '../models/user.model';
import { SupabaseService } from './supabase.service';

interface StoredSession extends AuthToken {
  user?: {
    id: string;
    username: string;
    fullName: string;
    role: UserRole;
    createdAt: string;
  };
}

const AUTH_STORAGE_KEY = 'auth_token';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private sb = inject(SupabaseService);

  private currentUser$ = new BehaviorSubject<User | null>(null);
  private isAuthenticated$ = new BehaviorSubject<boolean>(false);
  private initPromise: Promise<void>;

  constructor() {
    this.restoreLocalSessionSync();
    this.initPromise = this.loadSession();
  }

  waitUntilReady(): Promise<void> {
    return this.initPromise;
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

  isCurrentUser(userId: string): boolean {
    return this.currentUser$.value?.id === userId;
  }

  async login(credentials: LoginCredentials): Promise<{ success: boolean; message: string }> {
    const cleanUsername = credentials.username.trim();
    const cleanPin = credentials.pin.trim();

    if (!cleanUsername || !/^\d{4}$/.test(cleanPin)) {
      return { success: false, message: 'Ingresa usuario y PIN numérico de 4 dígitos.' };
    }

    try {
      // Verificación exclusivamente vía RPC segura (bcrypt en PostgreSQL, sin descargar PINs al cliente)
      const { data: rpcData, error: rpcError } = await this.sb.client.rpc('verify_user_pin', {
        p_username: cleanUsername,
        p_pin: cleanPin
      });

      if (rpcError) {
        return {
          success: false,
          message: this.isNetworkError(rpcError.message)
            ? 'No se pudo conectar con el servidor. Verifica tu conexión o el estado de Supabase.'
            : 'El servicio de autenticación no está disponible en la base de datos.'
        };
      }

      if (rpcData?.success && rpcData.user) {
        const user: User = {
          id: rpcData.user.id,
          username: rpcData.user.username,
          fullName: rpcData.user.fullName,
          role: rpcData.user.role as UserRole,
          createdAt: new Date(rpcData.user.createdAt)
        };
        this.saveSession(user);
        return { success: true, message: `Bienvenido, ${user.fullName}` };
      }

      return { success: false, message: rpcData?.message || 'Credenciales incorrectas.' };
    } catch {
      return { success: false, message: 'Error de conexión al iniciar sesión.' };
    }
  }

  async register(data: RegisterData): Promise<{ success: boolean; message: string }> {
    const cleanUsername = data.username.trim();
    const cleanFullName = data.fullName.trim();
    const cleanPin = data.pin.trim();

    if (cleanFullName.length < 3 || !/^[a-zA-Z0-9._-]{3,30}$/.test(cleanUsername)) {
      return {
        success: false,
        message: 'Nombre mínimo 3 caracteres y usuario alfanumérico sin espacios (3-30 caracteres).'
      };
    }
    if (!/^\d{4}$/.test(cleanPin)) {
      return { success: false, message: 'El PIN debe contener exactamente 4 dígitos numéricos.' };
    }

    try {
      const newId = this.generateId();

      const { data: rpcData, error: rpcError } = await this.sb.client.rpc('create_user_secure', {
        p_id: newId,
        p_username: cleanUsername,
        p_full_name: cleanFullName,
        p_role: data.role,
        p_pin: cleanPin
      });

      if (rpcError) {
        return {
          success: false,
          message: this.isNetworkError(rpcError.message)
            ? 'Sin conexión con el servidor para registrar el usuario.'
            : 'No se pudo crear el usuario mediante RPC segura.'
        };
      }

      return {
        success: Boolean(rpcData?.success),
        message: rpcData?.message || 'Operación completada.'
      };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Error al registrar usuario.' };
    }
  }

  logout(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    this.currentUser$.next(null);
    this.isAuthenticated$.next(false);
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
      return { success: false, message: 'No se puede cambiar el rol del administrador principal.' };
    }
    if (this.isCurrentUser(userId)) {
      return { success: false, message: 'No puedes modificar tu propio rol mientras tienes la sesión activa.' };
    }

    const { error } = await this.sb.client
      .from('users')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      return { success: false, message: 'Error al actualizar el rol del usuario.' };
    }
    return { success: true, message: 'Rol actualizado correctamente.' };
  }

  async deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
    if (userId === 'usr_admin_default') {
      return { success: false, message: 'No se puede eliminar el administrador principal.' };
    }
    if (this.isCurrentUser(userId)) {
      return { success: false, message: 'No puedes eliminar tu propio usuario activo.' };
    }

    const { error } = await this.sb.client
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      return { success: false, message: 'Error al eliminar el usuario.' };
    }
    return { success: true, message: 'Usuario eliminado correctamente.' };
  }

  private saveSession(user: User): void {
    const session: StoredSession = {
      token: 'session_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)),
      userId: user.id,
      role: user.role,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000),
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        createdAt: user.createdAt.toISOString()
      }
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    this.currentUser$.next(user);
    this.isAuthenticated$.next(true);
  }

  private restoreLocalSessionSync(): void {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;

    try {
      const session: StoredSession = JSON.parse(raw);
      if (session.expiresAt <= Date.now()) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }

      if (session.user?.id && session.user.role) {
        this.currentUser$.next({
          id: session.user.id,
          username: session.user.username,
          fullName: session.user.fullName,
          role: session.user.role,
          createdAt: new Date(session.user.createdAt)
        });
        this.isAuthenticated$.next(true);
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  private async loadSession(): Promise<void> {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;

    try {
      const session: StoredSession = JSON.parse(raw);
      if (session.expiresAt <= Date.now()) {
        this.logout();
        return;
      }

      const { data, error } = await this.sb.client
        .from('users')
        .select('id, username, full_name, role, created_at')
        .eq('id', session.userId)
        .maybeSingle();

      if (error) return;

      if (data) {
        const freshUser = this.mapRow(data);
        this.saveSession(freshUser);
      } else {
        this.logout();
      }
    } catch {
      // Conservar caché si hay corte de red temporal
    }
  }

  private isNetworkError(message?: string): boolean {
    const m = (message || '').toLowerCase();
    return m.includes('failed to fetch') || m.includes('network') || m.includes('err_name_not_resolved') || m.includes('fetch');
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
