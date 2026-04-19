import { Injectable } from '@angular/core';
import sodium from 'libsodium-wrappers';
import * as bip39 from 'bip39';
import { CryptoService, KeyPair } from './crypto.service';

@Injectable()
export class WebCryptoService extends CryptoService {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await sodium.ready;
    this.initialized = true;
  }

  private ensureReady(): void {
    if (!this.initialized) throw new Error('[CryptoService] call init() first');
  }

  generateMnemonic(): string {
    return bip39.generateMnemonic(128);
  }

  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic);
  }

  async keysFromMnemonic(mnemonic: string): Promise<KeyPair> {
    this.ensureReady();
    if (!bip39.validateMnemonic(mnemonic))
      throw new Error('[CryptoService] invalid BIP39 mnemonic');
    const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
    const kp = sodium.crypto_sign_seed_keypair(seedBuffer.subarray(0, 32));
    return { publicKey: kp.publicKey, privateKey: kp.privateKey };
  }

  blake2b(data: string | Uint8Array, outputLength = 32): Uint8Array {
    this.ensureReady();
    const bytes = typeof data === 'string' ? sodium.from_string(data) : data;
    return sodium.crypto_generichash(outputLength, bytes, null);
  }

  blake2bHex(data: string | Uint8Array, outputLength = 32): string {
    return this.toHex(this.blake2b(data, outputLength));
  }

  sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
    this.ensureReady();
    return sodium.crypto_sign_detached(message, privateKey);
  }

  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    this.ensureReady();
    try {
      return sodium.crypto_sign_verify_detached(signature, message, publicKey);
    } catch {
      return false;
    }
  }

  encrypt(
    plaintext: string,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
  ): { ciphertext: string; nonce: string } {
    this.ensureReady();
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const encrypted = sodium.crypto_box_easy(
      sodium.from_string(plaintext),
      nonce,
      this.edPublicKeyToX25519(recipientPublicKey),
      this.edPrivateKeyToX25519(senderPrivateKey),
    );
    return { ciphertext: this.toHex(encrypted), nonce: this.toHex(nonce) };
  }

  decrypt(
    ciphertext: string,
    nonce: string,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ): string | null {
    this.ensureReady();
    try {
      const decrypted = sodium.crypto_box_open_easy(
        this.fromHex(ciphertext),
        this.fromHex(nonce),
        this.edPublicKeyToX25519(senderPublicKey),
        this.edPrivateKeyToX25519(recipientPrivateKey),
      );
      return sodium.to_string(decrypted);
    } catch {
      return null;
    }
  }

  encryptWithKey(plaintext: string, key: Uint8Array): { ciphertext: string; nonce: string } {
    this.ensureReady();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
    return { ciphertext: this.toHex(encrypted), nonce: this.toHex(nonce) };
  }

  decryptWithKey(ciphertext: string, nonce: string, key: Uint8Array): string | null {
    this.ensureReady();
    try {
      const decrypted = sodium.crypto_secretbox_open_easy(
        this.fromHex(ciphertext),
        this.fromHex(nonce),
        key,
      );
      return sodium.to_string(decrypted);
    } catch {
      return null;
    }
  }

  edPublicKeyToX25519(edPublicKey: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_pk_to_curve25519(edPublicKey);
  }

  edPrivateKeyToX25519(edPrivateKey: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_sk_to_curve25519(edPrivateKey);
  }

  toHex(data: Uint8Array): string {
    return sodium.to_hex(data);
  }

  fromHex(hex: string): Uint8Array {
    return sodium.from_hex(hex);
  }

  fromString(str: string): Uint8Array {
    return sodium.from_string(str);
  }

  toString(data: Uint8Array): string {
    return sodium.to_string(data);
  }
}
