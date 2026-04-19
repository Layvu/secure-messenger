import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
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
  { path: '', redirectTo: 'onboarding', pathMatch: 'full' },
  { path: '**', redirectTo: 'onboarding' },
];
