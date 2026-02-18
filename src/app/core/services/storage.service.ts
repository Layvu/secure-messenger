import { Injectable } from '@angular/core';
import { createRxDatabase, RxDatabase, removeRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import * as CryptoJS from 'crypto-js';

const usersSchema = {
  title: 'users schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    username: { type: 'string' }, // Зашифровано
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
    text: { type: 'string' }, // Зашифровано
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
    id: { type: 'string', maxLength: 100 }, // Session ID
    state: { type: 'string' }, // Зашифрованный ratchet state (JSON)
  },
  required: ['id', 'state'],
};

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private db: RxDatabase | null = null;
  private encryptionKey: string | null = null;

  async initDB(dbName: string, encryptionKey: string) {
    if (this.db) return;
    const fullDbName = 'messenger_secure_' + dbName;
    try {
      await removeRxDatabase(fullDbName, getRxStorageDexie());
      console.log('Existing DB removed for clean init');
    } catch (err) {
      console.warn('No existing DB to remove:', err);
    }
    this.encryptionKey = encryptionKey;
    this.db = await createRxDatabase({
      name: fullDbName,
      storage: getRxStorageDexie(),
      multiInstance: true,
    });
    await this.db.addCollections({
      users: { schema: usersSchema },
      messages: { schema: messagesSchema },
      sessions: { schema: sessionsSchema },
    });
    console.log('Secure Storage Initialized');
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
    const secureUser = { ...user };
    secureUser.username = this.encrypt(user.username);
    return this.db.collections['users'].insert(secureUser);
  }

  async addMessage(msg: any) {
    if (!this.db) throw new Error('DB not initialized');
    const secureMsg = { ...msg };
    secureMsg.text = this.encrypt(msg.text);
    return this.db.collections['messages'].insert(secureMsg);
  }

  async addSession(session: any) {
    if (!this.db) throw new Error('DB not initialized');
    const secureSession = { ...session };
    secureSession.state = this.encrypt(session.state);
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
