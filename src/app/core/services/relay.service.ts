import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { CryptoService } from './crypto.service';
import { IdentityService } from './identity.service';

export interface IncomingMessage {
  from: string;
  payload: string;
  id: string;
}

@Injectable({
  providedIn: 'root',
})
export class RelayService {
  private socket!: Socket;
  private messageSubject = new Subject<IncomingMessage>();
  public messages$ = this.messageSubject.asObservable();

  constructor(
    private crypto: CryptoService,
    private identity: IdentityService,
  ) {}

  connect() {
    const user = this.identity.getUser();
    if (!user) {
      throw new Error('No active user');
    }

    this.socket = io('http://localhost:3000');

    this.socket.on('connect', () => {
      console.log('Connected to relay server');
      this.socket.emit('register', { publicKey: user.id });
    });

    this.socket.on('message', (data: IncomingMessage) => {
      console.log('Received raw message from', data.from);
      this.messageSubject.next(data);
    });

    this.socket.on('error', (err) => {
      console.error('Relay error:', err);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from relay');
    });
  }

  sendMessage(to: string, plainText: string) {
    if (!this.socket) {
      throw new Error('Socket not connected. Call connect() first.');
    }

    const user = this.identity.getUser();
    if (!user) throw new Error('No active user');

    const receiverPublicKeyEd = this.crypto.fromHex(to);
    const receiverPublicKeyX = this.crypto.convertEd25519PublicKeyToX25519(receiverPublicKeyEd);
    const myPrivateKeyEd = user.keyPair.privateKey;
    const myPrivateKeyX = this.crypto.convertEd25519PrivateKeyToX25519(myPrivateKeyEd);

    const encrypted = this.crypto.encryptMessage(plainText, receiverPublicKeyX, myPrivateKeyX);

    const payload = JSON.stringify({
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
    });

    this.socket.emit('sendMessage', { to, payload });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
