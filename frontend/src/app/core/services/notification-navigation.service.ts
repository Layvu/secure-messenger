import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StorageService } from './storage.service';
import { IdentityService } from './identity.service';

@Injectable({ providedIn: 'root' })
export class NotificationNavigationService {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly identity = inject(IdentityService);
  private readonly zone = inject(NgZone);

  // Инициализирует обработчики событий Service Worker и URL
  init(): void {
    this.listenForSwMessages();
    this.setLatestChatFlagIfFromNotification();
  }

  async navigateToLatestChat(): Promise<void> {
    if (!this.identity.getUser()) return;

    const previews$ = this.storage.getChatPreviews();
    if (!previews$) return;
    const previews = await firstValueFrom(previews$);

    const latest = previews[0];
    if (latest) {
      await this.router.navigate(['/chats', latest.contact.pubkey]);
    } else {
      await this.router.navigate(['/chats']);
    }
  }

  private listenForSwMessages(): void {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      if ((event.data as { type: string })?.type === 'NOTIFICATION_CLICK') {
        this.zone.run(() => this.navigateToLatestChat());
      }
    });
  }

  private setLatestChatFlagIfFromNotification(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('notification') === '1') {
      sessionStorage.setItem('dm_open_latest_chat', '1');
    }
  }
}
