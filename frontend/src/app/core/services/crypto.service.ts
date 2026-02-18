import { Injectable } from '@angular/core';
import sodium from 'libsodium-wrappers';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  private ready = false;

  constructor() {
    this.init();
  }

  async init() {
    await sodium.ready;
    this.ready = true;
    console.log('Libsodium is ready');
  }

  generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
    this.checkReady();
    return sodium.crypto_sign_seed_keypair(seed);
  }

  convertEd25519PublicKeyToX25519(ed25519PublicKey: Uint8Array): Uint8Array {
    this.checkReady();
    return sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519PublicKey);
  }

  convertEd25519PrivateKeyToX25519(ed25519PrivateKey: Uint8Array): Uint8Array {
    this.checkReady();
    return sodium.crypto_sign_ed25519_sk_to_curve25519(ed25519PrivateKey);
  }

  encryptMessage(
    message: string,
    receiverPublicKey: Uint8Array,
    myPrivateKey: Uint8Array,
  ): { ciphertext: string; nonce: string } {
    this.checkReady();
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const msgBytes = sodium.from_string(message);
    const encrypted = sodium.crypto_box_easy(msgBytes, nonce, receiverPublicKey, myPrivateKey);
    return {
      ciphertext: sodium.to_hex(encrypted),
      nonce: sodium.to_hex(nonce),
    };
  }

  decryptMessage(
    ciphertextHex: string,
    nonceHex: string,
    senderPublicKey: Uint8Array,
    myPrivateKey: Uint8Array,
  ): string {
    this.checkReady();
    const ciphertext = sodium.from_hex(ciphertextHex);
    const nonce = sodium.from_hex(nonceHex);
    try {
      const decryptedBytes = sodium.crypto_box_open_easy(
        ciphertext,
        nonce,
        senderPublicKey,
        myPrivateKey,
      );
      return sodium.to_string(decryptedBytes);
    } catch (e) {
      console.error('Decryption failed.');
      return '[UNABLE TO DECRYPT]';
    }
  }

  hash(data: string): string {
    this.checkReady();
    return sodium.to_hex(sodium.crypto_generichash(64, sodium.from_string(data), null));
  }

  toHex(data: Uint8Array): string {
    return sodium.to_hex(data);
  }

  fromHex(data: string): Uint8Array {
    return sodium.from_hex(data);
  }

  private checkReady() {
    if (!this.ready) throw new Error('Sodium not ready');
  }
}
