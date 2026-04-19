import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';

export interface PowResult {
  nonce: number;
  idHex: string;
  idBytes: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class ProofOfWorkService {
  constructor(private crypto: CryptoService) {}

  async mine(baseHashHex: string, difficultyBits: number, yieldEvery = 1000): Promise<PowResult> {
    const hexZeros = Math.floor(difficultyBits / 4);
    const targetPrefix = '0'.repeat(hexZeros);

    let nonce = 0;

    while (true) {
      const idBytes = this.crypto.blake2b(baseHashHex + nonce, 32);
      const idHex = this.crypto.toHex(idBytes);

      if (idHex.startsWith(targetPrefix)) {
        return { nonce, idHex, idBytes };
      }

      nonce++;

      // Чтобы вкладка не висла
      if (nonce % yieldEvery === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
  }

  verify(
    baseHashHex: string,
    nonce: number,
    expectedIdHex: string,
    difficultyBits: number,
  ): boolean {
    const hexZeros = Math.floor(difficultyBits / 4);
    const targetPrefix = '0'.repeat(hexZeros);

    if (!expectedIdHex.startsWith(targetPrefix)) return false;

    const idBytes = this.crypto.blake2b(baseHashHex + nonce, 32);
    return this.crypto.toHex(idBytes) === expectedIdHex;
  }
}
