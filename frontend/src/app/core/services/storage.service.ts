import { Observable } from 'rxjs';

export type MessageStatus = 'sent' | 'received' | 'read';

export interface MessageDoc {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number;
  status: MessageStatus;
  kind?: number;
  capsuleTags?: string[][];
}

export interface ContactDoc {
  pubkey: string;
  username: string;
  relays: string[];
  lastSeen?: number;
}

export interface IdentityDoc {
  id: 'local';
  pubkey: string;
  username: string;
  relays: string[];
}

export interface ChatPreview {
  contact: ContactDoc;
  lastMessage: MessageDoc | null;
}

export abstract class StorageService {
  abstract initDB(userId: string, encryptionKey: string, isRecovery?: boolean): Promise<void>;
  abstract closeDB(): Promise<void>;

  abstract addMessage(msg: MessageDoc): Promise<void>;
  abstract getMessages(contactPubkey: string): Observable<MessageDoc[]> | null;
  abstract getMessagesDirect(contactPubkey: string): Promise<MessageDoc[]>;
  abstract hasMessage(id: string): Promise<boolean>;

  abstract upsertContact(contact: ContactDoc): Promise<void>;
  abstract getContact(pubkey: string): Promise<ContactDoc | null>;
  abstract getContacts(): Observable<ContactDoc[]> | null;
  abstract getChatPreviews(): Observable<ChatPreview[]> | null;

  abstract upsertIdentity(identity: IdentityDoc): Promise<void>;
  abstract getIdentity(): Promise<IdentityDoc | null>;
}
