import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';
import { KeyConversionService } from './key-conversion.service';
import { EventService } from './event.service';
import { StorageService } from './storage.service';
import { SignedEvent } from '../models/event.model';

@Injectable({ providedIn: 'root' })
export class EventProcessorService {
  constructor(
    private crypto: CryptoService,
    private keyConversion: KeyConversionService,
    private eventService: EventService,
    private storage: StorageService,
  ) {}

  async processIncomingEvent(
    event: SignedEvent,
    myUserId: string,
    myKeyPairEd: { publicKey: Uint8Array; privateKey: Uint8Array },
  ): Promise<void> {
    if (!this.eventService.verifyEvent(event)) {
      console.warn('Event verification failed', event.id);
      return;
    }

    if (event.kind === 4) {
      await this.handleDirectMessage(event, myUserId, myKeyPairEd);
    }
  }

  private async handleDirectMessage(
    event: SignedEvent,
    myUserId: string,
    myKeyPairEd: { publicKey: Uint8Array; privateKey: Uint8Array },
  ): Promise<void> {
    const isForMe = event.tags.some((tag) => tag[0] === 'p' && tag[1] === myUserId);
    const isFromMe = event.pubkey === myUserId;

    if (!isForMe || isFromMe) return;

    let decryptedText: string | null = null;

    // Попытка расшифровать в формате { ciphertext, nonce }
    try {
      const parsed = JSON.parse(event.content);
      if (parsed.ciphertext && parsed.nonce) {
        const senderEdPub = this.crypto.fromHex(event.pubkey);
        const senderXPub = this.keyConversion.ed25519PublicKeyToX25519(senderEdPub);
        const myXPriv = this.keyConversion.ed25519PrivateKeyToX25519(myKeyPairEd.privateKey);

        decryptedText = this.crypto.decryptMessage(
          parsed.ciphertext,
          parsed.nonce,
          senderXPub,
          myXPriv,
        );
      }
    } catch {
      // Не JSON - возможно другой формат
    }

    if (!decryptedText) {
      // Здесь можно добавить поддержку NIP-04
      console.log('Could not decrypt message, unsupported format', event.id);
      return;
    }

    if (decryptedText) {
      await this.storage.addMessage({
        id: event.id,
        senderId: event.pubkey,
        receiverId: myUserId,
        text: decryptedText,
        timestamp: event.created_at * 1000,
        status: 'received',
      });
    }
  }
}
