import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { createRxDatabase, RxDatabase, RxCollection, removeRxDatabase, addRxPlugin } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import {
  StorageService,
  MessageDoc,
  ContactDoc,
  IdentityDoc,
  ChatPreview,
} from './storage.service';

const IS_DEV = typeof ngDevMode !== 'undefined' && ngDevMode;

if (IS_DEV) {
  addRxPlugin(RxDBDevModePlugin);
}

// RxDB Schema

const messagesSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 128 },
    senderId: { type: 'string', maxLength: 128 },
    receiverId: { type: 'string', maxLength: 128 },
    text: { type: 'string' },
    timestamp: { type: 'number', multipleOf: 1, minimum: 0, maximum: 100000000000000 },
    status: { type: 'string' },
    kind: { type: 'number' },
    capsuleTags: { type: 'string' },
  },
  required: ['id', 'senderId', 'receiverId', 'text', 'timestamp', 'status'],
  indexes: ['timestamp'],
  encrypted: ['text'],
} as const;

const contactsSchema = {
  version: 0,
  primaryKey: 'pubkey',
  type: 'object',
  properties: {
    pubkey: { type: 'string', maxLength: 128 },
    username: { type: 'string' },
    relays: { type: 'array', items: { type: 'string' } },
    lastSeen: { type: 'number', multipleOf: 1, minimum: 0, maximum: 100000000000000 },
  },
  required: ['pubkey', 'username'],
  encrypted: ['username', 'relays'],
} as const;

const identitySchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 16 },
    pubkey: { type: 'string' },
    username: { type: 'string' },
    relays: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'pubkey', 'username'],
  encrypted: ['username', 'relays'],
} as const;

const SS_RECOVERY_PENDING = 'dm_recovery_pending';
const SS_RECOVERY_KEY = 'dm_recovery_enc_key';
const SS_RECOVERY_USER = 'dm_recovery_user_id';

@Injectable()
export class WebStorageService extends StorageService {
  private db: RxDatabase | null = null;

  async initDB(userId: string, encryptionKey: string, isRecovery = false): Promise<void> {
    const dbName = this.dbName(userId);

    if (isRecovery) {
      await this.performRecovery(dbName, userId, encryptionKey);
      return;
    }

    if (sessionStorage.getItem(SS_RECOVERY_PENDING) === '1') {
      await this.finalizeRecovery();
      return;
    }

    if (this.db?.name === dbName) return;
    if (this.db) await this.closeDB();

    await this.openDatabase(dbName, encryptionKey);
  }

  async closeDB(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // Messages

  async addMessage(msg: MessageDoc): Promise<void> {
    const { capsuleTags, ...rest } = msg;
    const toStore: Record<string, unknown> = { ...rest };

    // иначе ошибка AJV-валидатора в проде
    if (capsuleTags !== undefined) {
      toStore['capsuleTags'] = JSON.stringify(capsuleTags);
    }
    await this.col('messages').upsert(toStore);
  }

  async hasMessage(id: string): Promise<boolean> {
    if (!this.db) return false;
    const doc = await this.col('messages').findOne(id).exec();
    return doc !== null;
  }

  getMessages(contactPubkey: string): Observable<MessageDoc[]> | null {
    if (!this.db) return null;
    return this.col('messages')
      .find({
        selector: { $or: [{ senderId: contactPubkey }, { receiverId: contactPubkey }] },
        sort: [{ timestamp: 'asc' }],
      })
      .$.pipe(map((docs) => docs.map((d) => this.deserializeMessage(d.toJSON()))));
  }

  async getMessagesDirect(contactPubkey: string): Promise<MessageDoc[]> {
    if (!this.db) return [];
    const docs = await this.col('messages')
      .find({
        selector: { $or: [{ senderId: contactPubkey }, { receiverId: contactPubkey }] },
        sort: [{ timestamp: 'asc' }],
      })
      .exec();
    return docs.map((d) => this.deserializeMessage(d.toJSON()));
  }

  // Contacts

  async upsertContact(contact: ContactDoc): Promise<void> {
    await this.col('contacts').upsert(contact);
  }

  async getContact(pubkey: string): Promise<ContactDoc | null> {
    const doc = await this.col('contacts').findOne(pubkey).exec();
    return doc ? (doc.toJSON() as ContactDoc) : null;
  }

  getContacts(): Observable<ContactDoc[]> | null {
    if (!this.db) return null;
    return this.col('contacts')
      .find()
      .$.pipe(map((docs) => docs.map((d) => d.toJSON() as ContactDoc)));
  }

  getChatPreviews(): Observable<ChatPreview[]> | null {
    if (!this.db) return null;

    // TODO: тяжёлая логика
    return this.col('contacts')
      .find()
      .$.pipe(
        map((docs) => docs.map((d) => d.toJSON() as ContactDoc)),
        switchMap((contacts) => {
          if (contacts.length === 0) return of<ChatPreview[]>([]);

          return combineLatest(
            contacts.map((contact) =>
              this.col('messages')
                .find({
                  selector: { $or: [{ senderId: contact.pubkey }, { receiverId: contact.pubkey }] },
                  sort: [{ timestamp: 'desc' }],
                  limit: 1,
                })
                .$.pipe(
                  map(
                    (docs): ChatPreview => ({
                      contact,
                      lastMessage: docs[0] ? (docs[0].toJSON() as MessageDoc) : null,
                    }),
                  ),
                ),
            ),
          );
        }),
        map((previews) =>
          [...previews].sort(
            (a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0),
          ),
        ),
      );
  }

  // Identity

  async upsertIdentity(identity: IdentityDoc): Promise<void> {
    await this.col('identity').upsert({ ...identity, id: 'local' });
  }

  async getIdentity(): Promise<IdentityDoc | null> {
    const doc = await this.col('identity').findOne('local').exec();
    return doc ? (doc.toJSON() as IdentityDoc) : null;
  }

  // helpers

  private dbName(userId: string): string {
    return `dm_${userId.substring(0, 16)}`;
  }

  private col(name: string): RxCollection {
    if (!this.db) throw new Error('[StorageService] DB not initialized');
    return this.db.collections[name];
  }

  private buildStorage() {
    const encrypted = wrappedKeyEncryptionCryptoJsStorage({ storage: getRxStorageDexie() });
    return IS_DEV ? wrappedValidateAjvStorage({ storage: encrypted }) : encrypted;
  }

  private async openDatabase(dbName: string, encryptionKey: string): Promise<void> {
    this.db = await createRxDatabase({
      name: dbName,
      storage: this.buildStorage(),
      password: encryptionKey,
      multiInstance: false,
      closeDuplicates: true,
    });
    await this.db.addCollections({
      messages: { schema: messagesSchema },
      contacts: { schema: contactsSchema },
      identity: { schema: identitySchema },
    });
    console.log('[StorageService] DB ready:', dbName);
  }

  private async performRecovery(
    dbName: string,
    userId: string,
    encryptionKey: string,
  ): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    try {
      await removeRxDatabase(dbName, getRxStorageDexie());
    } catch {
      await this.deleteIdbDatabases(dbName);
    }

    sessionStorage.setItem(SS_RECOVERY_PENDING, '1');
    sessionStorage.setItem(SS_RECOVERY_KEY, encryptionKey);
    sessionStorage.setItem(SS_RECOVERY_USER, userId);

    window.location.reload();
  }

  private async finalizeRecovery(): Promise<void> {
    const encKey = sessionStorage.getItem(SS_RECOVERY_KEY);
    const userId = sessionStorage.getItem(SS_RECOVERY_USER);

    sessionStorage.removeItem(SS_RECOVERY_PENDING);
    sessionStorage.removeItem(SS_RECOVERY_KEY);
    sessionStorage.removeItem(SS_RECOVERY_USER);

    if (!encKey || !userId) {
      console.error('[StorageService] recovery data missing');
      return;
    }

    await this.openDatabase(this.dbName(userId), encKey);
  }

  private async deleteIdbDatabases(rxdbName: string): Promise<void> {
    const prefix = `rxdb-dexie-${rxdbName}`;
    let names: string[];
    if (typeof indexedDB.databases === 'function') {
      const all = await indexedDB.databases();
      names = all.map((d) => d.name ?? '').filter((n) => n.startsWith(prefix));
    } else {
      // TODO: выводить названия столбцов в одном месте из схемы и переиспользовать везде
      names = ['', '--0--messages', '--0--contacts', '--0--identity', '--0--_rxdb_internal'].map(
        (s) => `${prefix}${s}`,
      );
    }

    await Promise.all(names.map((n) => this.deleteOneIdb(n)));
    await new Promise<void>((r) => setTimeout(r, 200));
  }

  // TODO: перейти на свежий синтаксис angular
  private deleteOneIdb(name: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => setTimeout(resolve, 600);
    });
  }

  private deserializeMessage(raw: Record<string, unknown>): MessageDoc {
    const doc = raw as unknown as MessageDoc & { capsuleTags?: string };
    return {
      ...doc,
      capsuleTags: doc.capsuleTags ? JSON.parse(doc.capsuleTags as string) : undefined,
    };
  }
}
