export type UserRole = 'admin' | 'waiter' | 'kitchen';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  createdAt: Date;
}

export interface AuthToken {
  token: string;
  userId: string;
  role: UserRole;
  expiresAt: number;
}

export interface LoginCredentials {
  username: string;
  pin: string;
}

export interface RegisterData {
  username: string;
  pin: string;
  fullName: string;
  role: UserRole;
}
