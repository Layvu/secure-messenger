import { Component, OnInit, OnDestroy, signal, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CryptoService } from '../../core/services/crypto.service';
import { IdentityService, UserProfile } from '../../core/services/identity.service';
import { RelayService, IncomingMessage } from '../../core/services/relay.service';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (user()) {
      <div class="header">
        <h2>Чат</h2>
        <div class="user-info">
          <span>Вы: {{ user()?.username }}</span>
          <div class="key-box">
            <code>{{ user()?.id | slice: 0 : 32 }}...</code>
            <button (click)="copyKey()">Копировать ключ</button>
          </div>
          @if (copied()) {
            <p class="success">Ключ скопирован!</p>
          }
        </div>
      </div>

      <div class="contacts">
        <input [(ngModel)]="contactId" placeholder="Вставьте Public Key контакта" />
        <button (click)="addContact()">Добавить контакт</button>
      </div>

      <div class="messages">
        @for (msg of messages(); track msg.id) {
          <div [class]="msg.from === user()?.id ? 'my-message' : 'their-message'">
            <b>{{ msg.from === user()?.id ? 'Я' : (msg.from | slice: 0 : 8) }}:</b>
            {{ msg.text }}
          </div>
        }
      </div>

      <div class="input-area">
        <input [(ngModel)]="newMessage" placeholder="Сообщение" (keyup.enter)="send()" />
        <button (click)="send()">Отправить</button>
      </div>
    }
  `,
  styles: [
    `
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .user-info {
        text-align: right;
      }
      .key-box {
        background: #f5f5f5;
        padding: 5px;
        margin: 5px 0;
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .key-box code {
        font-size: 11px;
        word-break: break-all;
      }
      .messages {
        border: 1px solid #ddd;
        padding: 20px;
        margin: 20px 0;
        min-height: 300px;
        max-height: 400px;
        overflow-y: auto;
      }
      .my-message {
        text-align: right;
        color: blue;
      }
      .their-message {
        text-align: left;
        color: green;
      }
      .input-area {
        display: flex;
        gap: 10px;
      }
      .input-area input {
        flex: 1;
        padding: 10px;
      }
      .success {
        color: green;
        font-size: 12px;
      }
      input {
        padding: 10px;
        margin: 5px 0;
      }
      button {
        padding: 10px 20px;
        cursor: pointer;
      }
    `,
  ],
})
export class ChatComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);

  constructor(
    private identity: IdentityService,
    private relay: RelayService,
    private storage: StorageService,
    private crypto: CryptoService,
  ) {}

  user = signal<UserProfile | null>(null);
  contactId = signal('');
  newMessage = signal('');
  messages = signal<{ id?: string; from: string; text: string }[]>([]);
  copied = signal(false);

  ngOnInit() {
    // Подписка на текущего пользователя
    this.identity.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.user.set(user);
      if (user) {
        this.initializeChat();
        // Можно загрузить историю из БД
        this.loadMessages();
      }
    });
  }

  private initializeChat() {
    const user = this.user();
    if (!user) return;

    this.relay.connect();

    // Подписка на входящие сообщения
    this.relay.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (incoming: IncomingMessage) => {
        await this.handleIncomingMessage(incoming);
      });
  }

  private async handleIncomingMessage(incoming: IncomingMessage) {
    const user = this.user();
    if (!user) return;

    console.log('Received raw message from', incoming.from);

    try {
      const senderPublicKeyEd = this.crypto.fromHex(incoming.from);
      const senderPublicKeyX = this.crypto.convertEd25519PublicKeyToX25519(senderPublicKeyEd);
      const myPrivateKeyEd = user.keyPair.privateKey;
      const myPrivateKeyX = this.crypto.convertEd25519PrivateKeyToX25519(myPrivateKeyEd);

      const { ciphertext, nonce } = JSON.parse(incoming.payload);
      const plainText = this.crypto.decryptMessage(
        ciphertext,
        nonce,
        senderPublicKeyX,
        myPrivateKeyX,
      );

      console.log('Decrypted message:', plainText);

      // Добавляем в локальный список
      this.messages.update((msgs) => [
        ...msgs,
        { id: incoming.id, from: incoming.from, text: plainText },
      ]);

      // Сохраняем в БД
      await this.storage.addMessage({
        id: incoming.id,
        senderId: incoming.from,
        receiverId: user.id,
        text: plainText,
        timestamp: Date.now(),
        status: 'received',
      });
    } catch (e) {
      console.error('Decryption error:', e);
    }
  }

  private async loadMessages() {
    // Загрузка истории из локальной БД
    // const msgs = await this.storage.getMessages(...);
  }

  copyKey() {
    const user = this.user();
    if (user) {
      navigator.clipboard.writeText(user.id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  ngOnDestroy() {
    this.relay.disconnect();
  }

  async send() {
    const user = this.user();
    if (!this.contactId() || !this.newMessage() || !user) return;

    console.log('Sending message to:', this.contactId().substring(0, 16) + '...');

    this.relay.sendMessage(this.contactId(), this.newMessage());

    this.messages.update((msgs) => [...msgs, { from: user.id, text: this.newMessage() }]);

    await this.storage.addMessage({
      id: 'temp_' + Date.now(),
      senderId: user.id,
      receiverId: this.contactId(),
      text: this.newMessage(),
      timestamp: Date.now(),
      status: 'sent',
    });

    this.newMessage.set('');
  }

  addContact() {
    if (this.contactId()) {
      this.storage.addUser({ id: this.contactId(), username: 'Contact' });
    }
  }
}
