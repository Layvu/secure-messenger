import { Injectable } from '@angular/core';
import { createRxDatabase, RxDatabase, removeRxDatabase } from 'rxdb';
import { wrappedValidateZSchemaStorage } from 'rxdb/plugins/validate-z-schema';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { addRxPlugin } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import CryptoJS from 'crypto-js';

addRxPlugin(RxDBDevModePlugin);

const usersSchema = {
  title: 'users schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    username: { type: 'string' },
  },
  required: ['id', 'username'],
};

const messagesSchema = {
  title: 'messages schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    senderId: { type: 'string' },
    receiverId: { type: 'string' },
    text: { type: 'string' },
    timestamp: { type: 'number' },
    status: { type: 'string' },
  },
  required: ['id', 'senderId', 'text', 'timestamp'],
};

const sessionsSchema = {
  title: 'sessions schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    state: { type: 'string' },
  },
  required: ['id', 'state'],
};

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private db: RxDatabase | null = null;
  private encryptionKey: string | null = null;

  async initDB(dbName: string, encryptionKey: string): Promise<void> {
    // Если уже открыта та же база, ничего не делаем
    if (this.db && this.db.name === 'messenger_secure_' + dbName) {
      return;
    }

    // Если открыта другая база, закрываем её
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.encryptionKey = null;
    }

    const fullDbName = 'messenger_secure_' + dbName;
    this.encryptionKey = encryptionKey;

    try {
      await this.tryOpenDatabase(fullDbName);
    } catch (error) {
      console.error('Failed to open database, attempting to remove and recreate...', error);
      await this.removeAndRecreateDatabase(fullDbName);
    }
  }

  private async tryOpenDatabase(fullDbName: string): Promise<void> {
    // Создаём storage с валидацией
    const storageWithValidation = wrappedValidateZSchemaStorage({
      storage: getRxStorageDexie(),
    });

    this.db = await createRxDatabase({
      name: fullDbName,
      storage: storageWithValidation,
      multiInstance: true,
      ignoreDuplicate: true,
    });

    await this.db.addCollections({
      users: { schema: usersSchema },
      messages: { schema: messagesSchema },
      sessions: { schema: sessionsSchema },
    });

    console.log('Storage initialized:', fullDbName);
  }

  private async removeAndRecreateDatabase(fullDbName: string): Promise<void> {
    try {
      await removeRxDatabase(fullDbName, getRxStorageDexie());
      console.log('Removed existing database:', fullDbName);
      await this.tryOpenDatabase(fullDbName);
      console.log('Storage recreated:', fullDbName);
    } catch (retryError) {
      console.error('Failed to recreate database:', retryError);
      throw retryError;
    }
  }

  async closeDB(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.encryptionKey = null;
      console.log('Storage closed');
    }
  }

  private encrypt(data: string): string {
    if (!this.encryptionKey) throw new Error('Storage locked');
    return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
  }

  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) throw new Error('Storage locked');
    const bytes = CryptoJS.AES.decrypt(ciphertext, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  async addUser(user: any) {
    if (!this.db) throw new Error('DB not initialized');
    const secureUser = { ...user, username: this.encrypt(user.username) };
    return this.db.collections['users'].insert(secureUser);
  }

  async addMessage(msg: any) {
    if (!this.db) throw new Error('DB not initialized');
    const secureMsg = { ...msg, text: this.encrypt(msg.text) };
    return this.db.collections['messages'].insert(secureMsg);
  }

  async addSession(session: any) {
    if (!this.db) throw new Error('DB not initialized');
    const secureSession = { ...session, state: this.encrypt(session.state) };
    return this.db.collections['sessions'].insert(secureSession);
  }

  getUsers() {
    if (!this.db) return null;
    return this.db.collections['users'].find().$;
  }

  getMessages(contactId: string) {
    if (!this.db) return null;
    return this.db.collections['messages'].find({
      selector: { $or: [{ senderId: contactId }, { receiverId: contactId }] },
      sort: [{ timestamp: 'asc' }],
    }).$;
  }

  getSessions(contactId: string) {
    if (!this.db) return null;
    return this.db.collections['sessions'].find({ selector: { id: contactId } }).$;
  }

  decryptUsers(users: any[]) {
    return users.map((u) => ({ ...u, username: this.decrypt(u.username) }));
  }

  decryptMessages(messages: any[]) {
    return messages.map((m) => ({ ...m, text: this.decrypt(m.text) }));
  }

  decryptSessions(sessions: any[]) {
    return sessions.map((s) => ({ ...s, state: this.decrypt(s.state) }));
  }
}
