import { Injectable } from '@angular/core';
import { argon2id } from 'hash-wasm';
import { PinService } from './pin.service';

@Injectable()
export class WebPinService extends PinService {
  async deriveKey(pin: string, saltHex: string): Promise<Uint8Array> {
    const saltBytes = this.hexToBytes(saltHex);
    const hashHex = await argon2id({
      password: pin,
      salt: saltBytes,
      parallelism: 1,
      iterations: 3, // time cost = 3
      memorySize: 65536, // 64 МБ
      hashLength: 32, // 32 байта
      outputType: 'hex',
    });
    return this.hexToBytes(hashHex);
  }

  generateSalt(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return this.keyToHex(bytes);
  }

  keyToHex(key: Uint8Array): string {
    return Array.from(key)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToBytes(hex: string): Uint8Array {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return arr;
  }
}
