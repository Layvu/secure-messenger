import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';

export interface PowResult {
  nonce: number;
  idHex: string;
  idBytes: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class ProofOfWorkService {
  private readonly PLACEHOLDER = '__POW_NONCE__';

  constructor(private crypto: CryptoService) {}

  async mine(template: string, difficulty: number, yieldEvery = 10000): Promise<PowResult> {
    let nonce = 0;
    const targetPrefix = '0'.repeat(difficulty);

    while (true) {
      const data = template.replace(this.PLACEHOLDER, nonce.toString());
      const hash = this.crypto.hash(data, 32);
      const hex = this.crypto.toHex(hash);

      if (hex.startsWith(targetPrefix)) {
        return { nonce, idHex: hex, idBytes: hash };
      }

      nonce++;
      if (nonce % yieldEvery === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
}
