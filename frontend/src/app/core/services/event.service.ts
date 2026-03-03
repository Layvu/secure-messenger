import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';
import { ProofOfWorkService } from './proof-of-work.service';
import { SignedEvent } from '../models/event.model';

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly POW_DIFFICULTY = 4;

  constructor(
    private crypto: CryptoService,
    private pow: ProofOfWorkService,
  ) {}

  private serializeEvent(
    pubkey: string,
    created_at: number,
    kind: number,
    tags: string[][],
    pow_nonce: number,
    content: string,
  ): string {
    return JSON.stringify([0, pubkey, created_at, kind, tags, pow_nonce, content]);
  }

  async createSignedEvent(
    senderPrivateKeyEd: Uint8Array,
    senderPublicKeyHex: string,
    kind: number,
    tags: string[][],
    content: string,
  ): Promise<SignedEvent> {
    const created_at = Math.floor(Date.now() / 1000);
    const baseSerialized = this.serializeEvent(
      senderPublicKeyHex,
      created_at,
      kind,
      tags,
      0,
      content,
    );
    const template = baseSerialized.replace(',0,', `,${this.pow['PLACEHOLDER']},`);

    const { nonce, idHex, idBytes } = await this.pow.mine(template, this.POW_DIFFICULTY);
    const signature = this.crypto.signDetached(idBytes, senderPrivateKeyEd);
    const sigHex = this.crypto.toHex(signature);

    return {
      id: idHex,
      pubkey: senderPublicKeyHex,
      created_at,
      kind,
      tags,
      pow_nonce: nonce,
      content,
      sig: sigHex,
    };
  }

  verifyEvent(event: SignedEvent): boolean {
    try {
      if (!event.id.startsWith('0'.repeat(this.POW_DIFFICULTY))) {
        return false;
      }

      const serialized = this.serializeEvent(
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.pow_nonce,
        event.content,
      );
      const expectedId = this.crypto.hashHex(serialized, 32);
      if (expectedId !== event.id) {
        return false;
      }

      const idBytes = this.crypto.fromHex(event.id);
      const sigBytes = this.crypto.fromHex(event.sig);
      const pubkeyBytes = this.crypto.fromHex(event.pubkey);
      return this.crypto.verifyDetached(sigBytes, idBytes, pubkeyBytes);
    } catch {
      return false;
    }
  }
}
