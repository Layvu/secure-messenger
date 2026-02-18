import { Injectable } from '@angular/core';
import { CryptoService, KeyPair } from './crypto.service';
import * as bip39 from 'bip39';
import { BehaviorSubject } from 'rxjs';

export interface UserProfile {
  id: string; // Public Key (Hex)
  username: string;
  keyPair: KeyPair;
  mnemonic?: string;
}

@Injectable({
  providedIn: 'root',
})
export class IdentityService {
  private currentUserSubject = new BehaviorSubject<UserProfile | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private crypto: CryptoService) {}

  async createNewAccount(username: string): Promise<string> {
    await this.crypto.init();
    const mnemonic = bip39.generateMnemonic();
    await this.restoreAccount(mnemonic, username);
    return mnemonic;
  }

  async restoreAccount(mnemonic: string, username: string = 'User'): Promise<void> {
    await this.crypto.init();
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seed32 = new Uint8Array(seed.slice(0, 32));
    const keyPair = this.crypto.generateKeyPairFromSeed(seed32);
    const user: UserProfile = {
      id: this.crypto.toHex(keyPair.publicKey),
      username,
      keyPair,
      mnemonic,
    };
    console.log(`Account loaded: ${user.id.substring(0, 8)}...`);
    this.currentUserSubject.next(user);
  }

  getUser() {
    return this.currentUserSubject.value;
  }
}
