import { Injectable } from '@angular/core';
import sodium from 'libsodium-wrappers';

@Injectable({ providedIn: 'root' })
export class KeyConversionService {
  ed25519PublicKeyToX25519(edPublicKey: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_pk_to_curve25519(edPublicKey);
  }

  ed25519PrivateKeyToX25519(edPrivateKey: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_sk_to_curve25519(edPrivateKey);
  }

  convertKeyPair(edKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }) {
    return {
      publicKey: this.ed25519PublicKeyToX25519(edKeyPair.publicKey),
      privateKey: this.ed25519PrivateKeyToX25519(edKeyPair.privateKey),
    };
  }
}
