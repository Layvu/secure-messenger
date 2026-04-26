import {
  provideAppInitializer,
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  inject,
} from '@angular/core';
import { provideRouter, withEnabledBlockingInitialNavigation } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { routes } from './app.routes';

import { CryptoService } from './core/services/crypto.service';
import { StorageService } from './core/services/storage.service';
import { RelayPoolService } from './core/services/relay-pool.service';
import { CameraService } from './core/services/camera.service';
import { ClipboardService } from './core/services/clipboard.service';
import { PinService } from './core/services/pin.service';
import { LocalStorageService } from './core/services/local-storage.service';

import { WebCryptoService } from './core/services/web-crypto.service';
import { WebStorageService } from './core/services/web-storage.service';
import { WebRelayPoolService } from './core/services/web-relay-pool.service';
import { WebCameraService } from './core/services/web-camera.service';
import { WebClipboardService } from './core/services/clipboard.service';
import { WebPinService } from './core/services/web-pin.service';
import { WebLocalStorageService } from './core/services/local-storage.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withEnabledBlockingInitialNavigation()),
    provideAppInitializer(() => inject(CryptoService).init()),
    provideIonicAngular({ mode: 'ios' }),

    { provide: CryptoService, useClass: WebCryptoService },
    { provide: StorageService, useClass: WebStorageService },
    { provide: RelayPoolService, useClass: WebRelayPoolService },
    { provide: CameraService, useClass: WebCameraService },
    { provide: ClipboardService, useClass: WebClipboardService },
    { provide: PinService, useClass: WebPinService },
    { provide: LocalStorageService, useClass: WebLocalStorageService },
  ],
};
