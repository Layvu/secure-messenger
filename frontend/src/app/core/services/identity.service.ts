import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CryptoService, KeyPair } from './crypto.service';
import { LocalStorageService } from './local-storage.service';
import { PinService } from './pin.service';

export interface UserProfile {
  id: string;
  username: string;
  keyPair: KeyPair;
}

const LS_USER_ID = 'dm_user_id';
const LS_PIN_SALT = 'dm_pin_salt';
const LS_ENC_MNEMONIC_CT = 'dm_enc_mnemonic_ct';
const LS_ENC_MNEMONIC_N = 'dm_enc_mnemonic_nonce';
const LS_LAST_ONLINE_TS = 'dm_last_online_ts'; // Unix-timestamp последнего успешного получения EOSE от реле

@Injectable({ providedIn: 'root' })
export class IdentityService {
  private currentUserSubject = new BehaviorSubject<UserProfile | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private crypto: CryptoService,
    private ls: LocalStorageService,
    private pin: PinService,
  ) {}

  hasStoredAccount(): boolean {
    return this.ls.has(LS_USER_ID) && this.ls.has(LS_ENC_MNEMONIC_CT);
  }

  getStoredUserId(): string | null {
    return this.ls.get(LS_USER_ID);
  }

  async createNewAccount(username: string): Promise<{ mnemonic: string; pubkey: string }> {
    await this.crypto.init();
    const mnemonic = this.crypto.generateMnemonic();
    const keyPair = await this.crypto.keysFromMnemonic(mnemonic);
    return { mnemonic, pubkey: this.crypto.toHex(keyPair.publicKey) };
  }

  async saveAccountWithPin(
    mnemonic: string,
    username: string,
    pinCode: string,
  ): Promise<{ encKey: string; userId: string }> {
    await this.crypto.init();
    const keyPair = await this.crypto.keysFromMnemonic(mnemonic);
    const userId = this.crypto.toHex(keyPair.publicKey);
    const saltHex = this.pin.generateSalt();
    const derived = await this.pin.deriveKey(pinCode, saltHex);
    const encKeyHex = this.pin.keyToHex(derived);
    const { ciphertext, nonce } = this.crypto.encryptWithKey(mnemonic, derived);

    this.ls.set(LS_USER_ID, userId);
    this.ls.set(LS_PIN_SALT, saltHex);
    this.ls.set(LS_ENC_MNEMONIC_CT, ciphertext);
    this.ls.set(LS_ENC_MNEMONIC_N, nonce);
    this.ls.set(LS_LAST_ONLINE_TS, '0');

    this.currentUserSubject.next({ id: userId, username, keyPair });
    return { encKey: encKeyHex, userId };
  }

  async unlockWithPin(pinCode: string): Promise<{ encKey: string; userId: string } | null> {
    await this.crypto.init();
    const saltHex = this.ls.get(LS_PIN_SALT);
    const ct = this.ls.get(LS_ENC_MNEMONIC_CT);
    const nonce = this.ls.get(LS_ENC_MNEMONIC_N);
    const userId = this.ls.get(LS_USER_ID);

    if (!saltHex || !ct || !nonce || !userId) return null;

    const derived = await this.pin.deriveKey(pinCode, saltHex);
    const mnemonic = this.crypto.decryptWithKey(ct, nonce, derived);
    if (!mnemonic) return null;

    const keyPair = await this.crypto.keysFromMnemonic(mnemonic);

    // TODO: state? В папку data-access?
    this.currentUserSubject.next({ id: userId, username: '', keyPair });
    return { encKey: this.pin.keyToHex(derived), userId };
  }

  async validateMnemonic(mnemonic: string): Promise<void> {
    await this.crypto.init();
    await this.crypto.keysFromMnemonic(mnemonic);
  }

  setUsername(username: string): void {
    const current = this.currentUserSubject.value;
    if (current) this.currentUserSubject.next({ ...current, username });
  }

  logout(): void {
    this.currentUserSubject.next(null);
  }

  getUser(): UserProfile | null {
    return this.currentUserSubject.value;
  }

  getLastOnlineTimestamp(): number {
    const stored = this.ls.get(LS_LAST_ONLINE_TS);
    return stored ? parseInt(stored, 10) : 0; // 0 - получить всю историю
  }

  markOnlineNow(): void {
    this.ls.set(LS_LAST_ONLINE_TS, Math.floor(Date.now() / 1000).toString());
  }
}
