import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { IdentityService } from './core/services/identity.service';

export const routes: Routes = [
  // TODO: inject в routes ?
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => {
      const identity = inject(IdentityService);
      return identity.hasStoredAccount() ? '/unlock' : '/onboarding';
    },
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./components/onboarding/onboarding.component').then((m) => m.OnboardingComponent),
  },
  {
    path: 'unlock',
    loadComponent: () =>
      import('./components/unlock/unlock.component').then((m) => m.UnlockComponent),
  },
  {
    path: 'add',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/accept-invite/accept-invite.component').then(
        (m) => m.AcceptInviteComponent,
      ),
  },
  {
    path: 'chats',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/chat-list/chat-list.component').then((m) => m.ChatListComponent),
  },
  {
    path: 'chats/add-contact',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/add-contact/add-contact.component').then((m) => m.AddContactComponent),
  },
  {
    path: 'chats/:pubkey',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/dialog/dialog.component').then((m) => m.DialogComponent),
  },
  { path: '**', redirectTo: '' },
];
