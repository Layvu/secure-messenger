import { Component, OnInit, signal, DestroyRef, inject } from '@angular/core';
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
import { addOutline, keyOutline, copyOutline, checkmarkOutline } from 'ionicons/icons';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IdentityService, UserProfile } from '../../core/services/identity.service';
import { StorageService, ChatPreview } from '../../core/services/storage.service';
import { ClipboardService } from '../../core/services/clipboard.service';

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
export class ChatListComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private identity = inject(IdentityService);
  private storage = inject(StorageService);
  private router = inject(Router);
  private clipboard = inject(ClipboardService);

  user = signal<UserProfile | null>(null);
  previews = signal<ChatPreview[]>([]);
  keyModalOpen = signal(false);
  keyCopied = signal(false);

  constructor() {
    addIcons({ addOutline, keyOutline, copyOutline, checkmarkOutline });
  }

  ngOnInit(): void {
    this.identity.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => this.user.set(u));

    const stream = this.storage.getChatPreviews();
    if (stream) {
      stream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => this.previews.set(p));
    }
  }

  async copyKey(): Promise<void> {
    const key = this.user()?.id;
    if (!key) return;
    await this.clipboard.writeText(key);
    this.keyCopied.set(true);
    setTimeout(() => this.keyCopied.set(false), 2000);
  }

  openKeyModal(): void {
    this.keyModalOpen.set(true);
  }
  closeKeyModal(): void {
    this.keyModalOpen.set(false);
  }

  openDialog(pubkey: string): void {
    this.router.navigate(['/chats', pubkey]);
  }

  goToAddContact(): void {
    this.router.navigate(['/chats/add-contact']);
  }

  // TODO: pipe, убрать вызовы функций в шаблонах
  formatTime(timestamp: number | undefined): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  }

  truncate(text: string, max = 42): string {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
}
