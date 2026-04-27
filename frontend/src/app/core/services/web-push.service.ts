import { Injectable, inject } from '@angular/core';
import { PushService } from './push.service';
import { IdentityService } from './identity.service';
import { environment } from '../../../environments/environment';

@Injectable()
export class WebPushService extends PushService {
  private readonly identity = inject(IdentityService);

  isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    try {
      await this.subscribeAndRegister();
      return true;
    } catch (e) {
      console.warn('[PushService] subscription failed:', e);
      return false;
    }
  }

  private async subscribeAndRegister(): Promise<void> {
    const vapidKey = await this.fetchVapidKey();
    if (!vapidKey) throw new Error('VAPID key unavailable');

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    const user = this.identity.getUser();
    if (!user) throw new Error('user not loaded');

    const httpUrl = this.relayHttpUrl();
    const res = await fetch(`${httpUrl}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: user.id, subscription: sub.toJSON() }),
    });

    if (!res.ok) throw new Error(`relay push register failed: ${res.status}`);
    console.log('[PushService] subscription registered with relay');
  }

  private async fetchVapidKey(): Promise<string | null> {
    try {
      const res = await fetch(`${this.relayHttpUrl()}/push/vapid-public-key`);
      const data = (await res.json()) as { publicKey: string };
      return data.publicKey;
    } catch {
      return null;
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  private relayHttpUrl(): string {
    return environment.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  }
}
