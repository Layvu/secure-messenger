import { Buffer } from 'buffer';

// чтобы библиотеки типа bip39 видели Buffer
(window as any).global = window;
(window as any).Buffer = Buffer;
(window as any).process = { env: { DEBUG: undefined }, version: '' };

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
