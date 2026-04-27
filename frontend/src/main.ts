import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Регистрируем SW при старте для offline-кэширования
// TODO: вынести сервис
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/dm-sw.js', { scope: '/' })
      .then((reg) => console.log('[SW] registered, scope:', reg.scope))
      .catch((err) => console.warn('[SW] registration failed:', err));
  });
}

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
