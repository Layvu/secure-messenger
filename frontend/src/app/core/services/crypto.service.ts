export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export abstract class CryptoService {
  abstract init(): Promise<void>;

  abstract generateMnemonic(): string;
  abstract validateMnemonic(mnemonic: string): boolean;
  abstract keysFromMnemonic(mnemonic: string): Promise<KeyPair>;

  abstract blake2b(data: string | Uint8Array, outputLength?: number): Uint8Array;
  abstract blake2bHex(data: string | Uint8Array, outputLength?: number): string;

  abstract sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
  abstract verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;

  abstract encrypt(
    plaintext: string,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
  ): { ciphertext: string; nonce: string };

  abstract decrypt(
    ciphertext: string,
    nonce: string,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ): string | null;

  abstract encryptWithKey(
    plaintext: string,
    key: Uint8Array,
  ): { ciphertext: string; nonce: string };
  abstract decryptWithKey(ciphertext: string, nonce: string, key: Uint8Array): string | null;

  abstract edPublicKeyToX25519(edPublicKey: Uint8Array): Uint8Array;
  abstract edPrivateKeyToX25519(edPrivateKey: Uint8Array): Uint8Array;

  abstract toHex(data: Uint8Array): string;
  abstract fromHex(hex: string): Uint8Array;
  abstract fromString(str: string): Uint8Array;
  abstract toString(data: Uint8Array): string;
}
