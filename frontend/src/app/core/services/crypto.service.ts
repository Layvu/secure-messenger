import { Injectable } from '@angular/core';
import sodium from 'libsodium-wrappers';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private ready = false;

  async init(): Promise<void> {
    await sodium.ready;
    this.ready = true;
  }

  private ensureReady(): void {
    if (!this.ready) throw new Error('CryptoService not initialized');
  }

  // Хеширование
  hash(data: string, length: number = 64): Uint8Array {
    this.ensureReady();
    return sodium.crypto_generichash(length, sodium.from_string(data), null);
  }

  hashHex(data: string, length: number = 64): string {
    return this.toHex(this.hash(data, length));
  }

  // Преобразования
  fromHex(hex: string): Uint8Array {
    return sodium.from_hex(hex);
  }

  toHex(data: Uint8Array): string {
    return sodium.to_hex(data);
  }

  fromString(str: string): Uint8Array {
    return sodium.from_string(str);
  }

  toString(data: Uint8Array): string {
    return sodium.to_string(data);
  }

  // Подписи (Ed25519)
  signDetached(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
    this.ensureReady();
    return sodium.crypto_sign_detached(message, privateKey);
  }

  verifyDetached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
    this.ensureReady();
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  }

  // Шифрование (X25519)
  encryptMessage(
    message: string,
    receiverPublicKeyX: Uint8Array,
    senderPrivateKeyX: Uint8Array,
  ): { ciphertext: string; nonce: string } {
    this.ensureReady();
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const msgBytes = this.fromString(message);
    const encrypted = sodium.crypto_box_easy(
      msgBytes,
      nonce,
      receiverPublicKeyX,
      senderPrivateKeyX,
    );
    return {
      ciphertext: this.toHex(encrypted),
      nonce: this.toHex(nonce),
    };
  }

  decryptMessage(
    ciphertextHex: string,
    nonceHex: string,
    senderPublicKeyX: Uint8Array,
    recipientPrivateKeyX: Uint8Array,
  ): string | null {
    this.ensureReady();
    try {
      const ciphertext = this.fromHex(ciphertextHex);
      const nonce = this.fromHex(nonceHex);
      const decrypted = sodium.crypto_box_open_easy(
        ciphertext,
        nonce,
        senderPublicKeyX,
        recipientPrivateKeyX,
      );
      return this.toString(decrypted);
    } catch {
      return null;
    }
  }

  // Генерация ключей
  generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
    this.ensureReady();
    return sodium.crypto_sign_seed_keypair(seed);
  }
}
