import { Component, OnInit, signal, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IdentityService, UserProfile } from '../../core/services/identity.service';
import { StorageService } from '../../core/services/storage.service';
import { CryptoService } from '../../core/services/crypto.service';
import { KeyConversionService } from '../../core/services/key-conversion.service';
import { EventService } from '../../core/services/event.service';
import { RelayPoolService } from '../../core/services/relay-pool.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private identity = inject(IdentityService);
  private storage = inject(StorageService);
  private crypto = inject(CryptoService);
  private keyConversion = inject(KeyConversionService);
  private eventService = inject(EventService);
  private relayPool = inject(RelayPoolService);

  user = signal<UserProfile | null>(null);
  contactId = signal('');
  newMessage = signal('');
  messages = signal<any[]>([]);
  copied = signal(false);

  ngOnInit(): void {
    this.identity.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => this.user.set(user));
  }

  onContactChanged(): void {
    const contact = this.contactId();
    if (contact?.length > 30) {
      this.loadMessages(contact);
    }
  }

  private loadMessages(contactPubKey: string): void {
    const messages$ = this.storage.getMessages(contactPubKey);
    if (!messages$) {
      console.warn('Storage not ready');
      return;
    }

    messages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((messages) => {
      const plainMessages = this.storage.decryptMessages(messages.map((m) => m.toJSON?.() ?? m));
      this.messages.set(plainMessages);
    });
  }

  copyId(): void {
    const user = this.user();
    if (user) {
      navigator.clipboard.writeText(user.id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  async send(): Promise<void> {
    const text = this.newMessage();
    const recipientId = this.contactId();
    const currentUser = this.user();

    if (!recipientId || !text || !currentUser) return;

    try {
      // Конвертация ключей для шифрования
      const recipientEdPub = this.crypto.fromHex(recipientId);
      const recipientXPub = this.keyConversion.ed25519PublicKeyToX25519(recipientEdPub);
      const myXPriv = this.keyConversion.ed25519PrivateKeyToX25519(currentUser.keyPair.privateKey);

      // Шифрование сообщения
      const encrypted = this.crypto.encryptMessage(text, recipientXPub, myXPriv);
      const content = JSON.stringify(encrypted);

      // Создание подписанного события (капсулы)
      const event = await this.eventService.createSignedEvent(
        currentUser.keyPair.privateKey,
        currentUser.id,
        4, // kind 4 = зашифрованное прямое сообщение
        [['p', recipientId]],
        content,
      );

      // Публикация в реле
      this.relayPool.publish(event);

      // Сохранение в локальную БД (открытый текст, но БД зашифрует сама)
      await this.storage.addMessage({
        id: event.id,
        senderId: currentUser.id,
        receiverId: recipientId,
        text: text,
        timestamp: event.created_at * 1000,
        status: 'sent',
      });

      this.newMessage.set('');
    } catch (error) {
      console.error('Ошибка при отправке сообщения:', error);
    }
  }
}
