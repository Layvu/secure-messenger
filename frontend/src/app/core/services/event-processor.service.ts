import { Injectable, inject } from '@angular/core';
import { CryptoService, KeyPair } from './crypto.service';
import { CapsuleService } from './capsule.service';
import { StorageService } from './storage.service';
import { ContactService } from './contact.service';
import { SignedCapsule, CapsuleKind } from '../models/capsule.model';

@Injectable({ providedIn: 'root' })
export class EventProcessorService {
  private readonly crypto = inject(CryptoService);
  private readonly capsule = inject(CapsuleService);
  private readonly storage = inject(StorageService);
  private readonly contactSvc = inject(ContactService);

  async processIncomingCapsule(
    capsule: SignedCapsule,
    myPubkeyHex: string,
    myKeyPair: KeyPair,
  ): Promise<void> {
    if (!this.capsule.verify(capsule)) {
      console.warn('[EventProcessor] verification failed - capsule dropped:', capsule.id);
      return;
    }

    switch (capsule.kind) {
      case CapsuleKind.PROFILE_UPDATE:
        await this.handleProfileUpdate(capsule, myPubkeyHex);
        break;
      case CapsuleKind.DIRECT_MESSAGE:
        await this.handleDirectMessage(capsule, myPubkeyHex, myKeyPair);
        break;
      default:
        console.debug('[EventProcessor] unhandled kind:', capsule.kind, capsule.id);
    }
  }

  private async handleProfileUpdate(capsule: SignedCapsule, myPubkeyHex: string): Promise<void> {
    if (capsule.pubkey === myPubkeyHex) return;

    const isForMe = capsule.tags.some((t) => t[0] === 'p' && t[1] === myPubkeyHex);
    if (!isForMe) return;

    let profile: { username?: string; relays?: string[] };
    try {
      profile = JSON.parse(capsule.content) as { username?: string; relays?: string[] };
    } catch {
      console.warn('[EventProcessor] kind:0 malformed content:', capsule.id);
      return;
    }

    const existing = await this.storage.getContact(capsule.pubkey);

    await this.storage.upsertContact({
      pubkey: capsule.pubkey,
      username: profile.username ?? existing?.username ?? `${capsule.pubkey.slice(0, 8)}…`,
      relays: Array.isArray(profile.relays) ? profile.relays : (existing?.relays ?? []),
      lastSeen: capsule.created_at * 1000,
    });

    if (!existing) {
      await this.contactSvc.publishProfileUpdateTo(capsule.pubkey);
    }
  }

  private async handleDirectMessage(
    capsule: SignedCapsule,
    myPubkeyHex: string,
    myKeyPair: KeyPair,
  ): Promise<void> {
    const isForMe = capsule.tags.some((t) => t[0] === 'p' && t[1] === myPubkeyHex);
    const isFromMe = capsule.pubkey === myPubkeyHex;

    if (!isForMe && !isFromMe) return;

    if (isFromMe) {
      await this.handleOwnMessageSync(capsule, myPubkeyHex, myKeyPair);
      return;
    }

    let decrypted: string | null = null;
    try {
      const parsed = JSON.parse(capsule.content) as { ciphertext?: string; nonce?: string };
      if (!parsed.ciphertext || !parsed.nonce) return;

      decrypted = this.crypto.decrypt(
        parsed.ciphertext,
        parsed.nonce,
        this.crypto.fromHex(capsule.pubkey),
        myKeyPair.privateKey,
      );
    } catch (e) {
      console.warn('[EventProcessor] content parse error:', capsule.id, e);
      return;
    }

    if (!decrypted) return;

    await this.ensureContactExists(capsule.pubkey, myPubkeyHex);

    await this.storage.addMessage({
      id: capsule.id,
      senderId: capsule.pubkey,
      receiverId: myPubkeyHex,
      text: decrypted,
      timestamp: capsule.created_at * 1000,
      status: 'received',
      kind: capsule.kind,
      capsuleTags: capsule.tags,
    });
  }

  private async handleOwnMessageSync(
    capsule: SignedCapsule,
    myPubkeyHex: string,
    myKeyPair: KeyPair,
  ): Promise<void> {
    const recipientPubkeyHex = capsule.tags.find((t) => t[0] === 'p')?.[1];
    if (!recipientPubkeyHex) return;

    let decrypted: string | null = null;
    try {
      const parsed = JSON.parse(capsule.content) as { ciphertext?: string; nonce?: string };
      if (!parsed.ciphertext || !parsed.nonce) return;

      decrypted = this.crypto.decrypt(
        parsed.ciphertext,
        parsed.nonce,
        this.crypto.fromHex(recipientPubkeyHex),
        myKeyPair.privateKey,
      );
    } catch {
      return;
    }

    if (!decrypted) return;

    await this.storage.addMessage({
      id: capsule.id,
      senderId: myPubkeyHex,
      receiverId: recipientPubkeyHex,
      text: decrypted,
      timestamp: capsule.created_at * 1000,
      status: 'sent',
      kind: capsule.kind,
      capsuleTags: capsule.tags,
    });
  }

  private async ensureContactExists(pubkey: string, myPubkeyHex: string): Promise<void> {
    if (pubkey === myPubkeyHex) return;
    const existing = await this.storage.getContact(pubkey);
    if (existing) return;
    await this.storage.upsertContact({
      pubkey,
      username: `${pubkey.slice(0, 8)}…`,
      relays: [],
    });
  }
}
