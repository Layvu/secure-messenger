import { Injectable, inject, Injector } from '@angular/core';
import { IdentityService } from './identity.service';
import { StorageService } from './storage.service';
import { CapsuleService } from './capsule.service';
import { RelayPoolService } from './relay-pool.service';
import { CapsuleKind } from '../models/capsule.model';

export interface InviteData {
  pubkey: string;
  relays: string[];
  name?: string;
}

const PUBKEY_REGEX = /^[0-9a-f]{64}$/;

@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly identity = inject(IdentityService);
  private readonly storage = inject(StorageService);
  private readonly capsule = inject(CapsuleService);
  private readonly injector = inject(Injector);

  // Lazy-loading спасает от циклических зависимостей DI
  private get relayPool(): RelayPoolService {
    return this.injector.get(RelayPoolService);
  }

  generateInviteUrl(): string | null {
    const user = this.identity.getUser();
    if (!user) return null;
    const params = new URLSearchParams({ pubkey: user.id });
    return `${window.location.origin}/add?${params.toString()}`;
  }

  parseInvite(raw: string): InviteData | null {
    try {
      const url = new URL(raw);
      const pubkey = url.searchParams.get('pubkey');
      if (!pubkey || !PUBKEY_REGEX.test(pubkey)) return null;

      const relaysRaw = url.searchParams.get('relays') ?? '';
      const relays = relaysRaw
        ? relaysRaw.split(',').filter((r) => r.startsWith('wss://') || r.startsWith('ws://'))
        : [];
      return { pubkey, relays };
    } catch {
      return null;
    }
  }

  async shareInvite(): Promise<'shared' | 'copied' | 'error'> {
    const url = this.generateInviteUrl();
    if (!url) return 'error';

    if (navigator.share) {
      try {
        await navigator.share({ title: 'DM', text: 'Добавь меня в DM', url });
        return 'shared';
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return 'shared';
        console.warn('[ContactService] share failed:', e);
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'error';
    }
  }

  async publishProfileUpdateTo(recipientPubkey: string): Promise<void> {
    const user = this.identity.getUser();
    if (!user) return;

    const identity = await this.storage.getIdentity();
    const content = JSON.stringify({
      username: identity?.username ?? user.username,
      relays: identity?.relays ?? [],
    });

    try {
      const cap = await this.capsule.build({
        kind: CapsuleKind.PROFILE_UPDATE,
        plaintextContent: content,
        recipientPubkeyHex: recipientPubkey,
      });
      this.relayPool.publish(cap);
    } catch (e) {
      console.warn('[ContactService] kind:0 publish failed:', e);
    }
  }
}
