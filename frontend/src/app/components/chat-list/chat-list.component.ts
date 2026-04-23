import { Component, signal, inject } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonList,
  IonItem,
  IonAvatar,
  IonLabel,
  IonIcon,
  IonNote,
  IonModal,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  keyOutline,
  copyOutline,
  checkmarkOutline,
  shareOutline,
} from 'ionicons/icons';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';

import { IdentityService, UserProfile } from '../../core/services/identity.service';
import { StorageService, ChatPreview } from '../../core/services/storage.service';
import { ClipboardService } from '../../core/services/clipboard.service';
import { ContactService } from '../../core/services/contact.service';

type ShareState = 'idle' | 'copied' | 'shared' | 'error';

@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonAvatar,
    IonLabel,
    IonIcon,
    IonNote,
    IonModal,
  ],
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.scss'],
})
export class ChatListComponent {
  private readonly identity = inject(IdentityService);
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private readonly clipboard = inject(ClipboardService);
  private readonly contactSvc = inject(ContactService);

  readonly user = toSignal(this.identity.currentUser$, { initialValue: null });
  readonly previews = toSignal(this.storage.getChatPreviews() ?? EMPTY, {
    initialValue: [] as ChatPreview[],
  });

  readonly keyModalOpen = signal(false);
  readonly qrDataUrl = signal<string | null>(null);
  readonly shareState = signal<ShareState>('idle');

  constructor() {
    addIcons({ addOutline, keyOutline, copyOutline, checkmarkOutline, shareOutline });
  }

  async openKeyModal(): Promise<void> {
    await this.generateQr();
    this.shareState.set('idle');
    this.keyModalOpen.set(true);
  }

  closeKeyModal(): void {
    this.keyModalOpen.set(false);
  }

  async copyKey(): Promise<void> {
    const key = this.user()?.id;
    if (!key) return;
    await this.clipboard.writeText(key);

    this.shareState.set('copied');
    setTimeout(() => this.shareState.set('idle'), 2000);
  }

  async shareInvite(): Promise<void> {
    const result = await this.contactSvc.shareInvite();

    this.shareState.set(result);
    if (result === 'copied') {
      setTimeout(() => this.shareState.set('idle'), 2500);
    }
  }

  shareButtonLabel(): string {
    switch (this.shareState()) {
      case 'copied':
        return 'Ссылка скопирована!';
      case 'error':
        return 'Ошибка, попробуйте ещё';
      default:
        return 'Поделиться контактом';
    }
  }

  shareButtonColor(): string {
    switch (this.shareState()) {
      case 'copied':
        return 'success';
      case 'error':
        return 'danger';
      default:
        return 'primary';
    }
  }

  openDialog(pubkey: string): void {
    this.router.navigate(['/chats', pubkey]);
  }

  goToAddContact(): void {
    this.router.navigate(['/chats/add-contact']);
  }

  // TODO: pipe
  formatTime(timestamp: number | undefined): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const isToday = date.toDateString() === new Date().toDateString();
    return isToday
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  }

  truncate(text: string, max = 42): string {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  private async generateQr(): Promise<void> {
    if (this.qrDataUrl()) return;
    const inviteUrl = this.contactSvc.generateInviteUrl();
    if (!inviteUrl) return;
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(inviteUrl, { width: 240, margin: 2 });
      this.qrDataUrl.set(dataUrl);
    } catch (e) {
      console.error('[ChatList] QR generation failed:', e);
    }
  }
}
