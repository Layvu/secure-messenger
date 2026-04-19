import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CryptoService } from './crypto.service';
import { ProofOfWorkService } from './proof-of-work.service';
import { StorageService } from './storage.service';
import { IdentityService } from './identity.service';
import { SignedCapsule, BuildCapsuleParams, CapsuleKind } from '../models/capsule.model';

@Injectable({ providedIn: 'root' })
export class CapsuleService {
  static readonly POW_DIFFICULTY_BITS = 16; // 4 hex нуля

  constructor(
    private crypto: CryptoService,
    private pow: ProofOfWorkService,
    private storage: StorageService,
    private identity: IdentityService,
  ) {}

  private serializeForBaseHash(
    pubkey: string,
    created_at: number,
    kind: number,
    tags: string[][],
    content: string,
  ): string {
    return JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  }

  async build(params: BuildCapsuleParams): Promise<SignedCapsule> {
    const me = this.identity.getUser();
    if (!me) throw new Error('[CapsuleService] user not loaded');

    const { kind, plaintextContent, extraTags = [], recipientPubkeyHex } = params;
    const created_at = Math.floor(Date.now() / 1000);

    // Шифрование
    let content: string;
    if (kind === CapsuleKind.DIRECT_MESSAGE) {
      if (!recipientPubkeyHex) throw new Error('[CapsuleService] recipientPubkeyHex required');
      const encrypted = this.crypto.encrypt(
        plaintextContent,
        this.crypto.fromHex(recipientPubkeyHex),
        me.keyPair.privateKey,
      );
      content = JSON.stringify(encrypted);
    } else {
      content = plaintextContent;
    }

    // Теги с DAG
    const pTag = recipientPubkeyHex ? [['p', recipientPubkeyHex]] : [];
    const dagTags =
      kind === CapsuleKind.DIRECT_MESSAGE && recipientPubkeyHex
        ? await this.buildDagTags(recipientPubkeyHex)
        : [];
    const tags = this.sortTags([...pTag, ...dagTags, ...extraTags]);

    const serializedBase = this.serializeForBaseHash(me.id, created_at, kind, tags, content);
    const baseHashHex = this.crypto.blake2bHex(serializedBase, 32);

    const { nonce, idHex, idBytes } = await this.pow.mine(
      baseHashHex,
      CapsuleService.POW_DIFFICULTY_BITS,
    );

    const sig = this.crypto.toHex(this.crypto.sign(idBytes, me.keyPair.privateKey));

    return { id: idHex, pubkey: me.id, created_at, kind, tags, pow_nonce: nonce, content, sig };
  }

  verify(capsule: SignedCapsule): boolean {
    try {
      const sortedTags = this.sortTags(capsule.tags);

      const serializedBase = this.serializeForBaseHash(
        capsule.pubkey,
        capsule.created_at,
        capsule.kind,
        sortedTags,
        capsule.content,
      );
      const baseHashHex = this.crypto.blake2bHex(serializedBase, 32);

      if (
        !this.pow.verify(
          baseHashHex,
          capsule.pow_nonce,
          capsule.id,
          CapsuleService.POW_DIFFICULTY_BITS,
        )
      ) {
        return false;
      }

      return this.crypto.verify(
        this.crypto.fromHex(capsule.id),
        this.crypto.fromHex(capsule.sig),
        this.crypto.fromHex(capsule.pubkey),
      );
    } catch {
      return false;
    }
  }

  // Utils

  private async buildDagTags(contactPubkeyHex: string): Promise<string[][]> {
    try {
      const msgs = await this.storage.getMessagesDirect(contactPubkeyHex);
      if (msgs.length === 0) return [];

      const recentIds = msgs.slice(-2).map((m) => m.id);
      return [['e', ...recentIds]];
    } catch (e) {
      console.warn('[CapsuleService] buildDagTags failed:', e);
      return [];
    }
  }

  private sortTags(tags: string[][]): string[][] {
    return [...tags].sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
  }
}
