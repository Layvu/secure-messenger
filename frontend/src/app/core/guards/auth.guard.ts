import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { IdentityService } from '../services/identity.service';

export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const identity = inject(IdentityService);
  const router = inject(Router);

  if (identity.getUser()) {
    return true;
  }
  if (!identity.hasStoredAccount()) {
    return router.createUrlTree(['/onboarding']);
  }

  return router.createUrlTree(['/unlock'], {
    queryParams: { returnUrl: state.url },
  });
};
