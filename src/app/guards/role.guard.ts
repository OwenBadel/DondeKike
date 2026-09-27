import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {

  private authService = inject(AuthService);
  private router = inject(Router);

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const expectedRoles = (route.data?.['roles'] as UserRole[]) || [];
    const userRole = this.authService.userRole;

    if (!this.authService.isLoggedIn) {
      return this.router.createUrlTree(['/login']);
    }

    if (expectedRoles.length === 0 || (userRole && expectedRoles.includes(userRole))) {
      return true;
    }

    return this.router.createUrlTree(['/dashboard']);
  }
}
