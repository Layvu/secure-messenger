import { Injectable } from '@angular/core';
import { CryptoService, KeyPair } from './crypto.service';
import { CapsuleService } from './capsule.service';
import { StorageService } from './storage.service';
import { SignedCapsule, CapsuleKind } from '../models/capsule.model';

@Injectable({ providedIn: 'root' })
export class EventProcessorService {
  // TODO: инжектить
  constructor(
    private readonly crypto: CryptoService,
    private readonly capsule: CapsuleService,
    private readonly storage: StorageService,
  ) {}

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
      case CapsuleKind.DIRECT_MESSAGE:
        await this.handleDirectMessage(capsule, myPubkeyHex, myKeyPair);
        break;
      default:
        console.debug('[EventProcessor] unhandled kind:', capsule.kind, capsule.id);
    }
  }

  private async handleDirectMessage(
    capsule: SignedCapsule,
    myPubkeyHex: string,
    myKeyPair: KeyPair,
  ): Promise<void> {
    const isForMe = capsule.tags.some((t) => t[0] === 'p' && t[1] === myPubkeyHex);
    const isFromMe = capsule.pubkey === myPubkeyHex;
    if (!isForMe || isFromMe) return;

    let decrypted: string | null = null;
    try {
      const parsed = JSON.parse(capsule.content) as { ciphertext?: string; nonce?: string };
      if (!parsed.ciphertext || !parsed.nonce) {
        console.warn('[EventProcessor] malformed content:', capsule.id);
        return;
      }
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

    if (!decrypted) {
      console.warn('[EventProcessor] decryption failed:', capsule.id);
      return;
    }

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
}
