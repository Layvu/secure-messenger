import { Component, signal, inject, viewChild, computed, effect, untracked } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonFooter,
  IonInput,
  IonButton,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { sendOutline } from 'ionicons/icons';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';

import { IdentityService } from '../../core/services/identity.service';
import { StorageService, MessageDoc, ContactDoc } from '../../core/services/storage.service';
import { CapsuleService } from '../../core/services/capsule.service';
import { RelayPoolService } from '../../core/services/relay-pool.service';
import { CapsuleKind } from '../../core/models/capsule.model';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonFooter,
    IonInput,
    IonButton,
    IonIcon,
  ],
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.scss'],
})
export class DialogComponent {
  private readonly content = viewChild<IonContent>(IonContent);

  private readonly route = inject(ActivatedRoute);
  private readonly identity = inject(IdentityService);
  private readonly storage = inject(StorageService);
  private readonly capsuleSvc = inject(CapsuleService);
  private readonly relayPool = inject(RelayPoolService);

  readonly recipientPubkey = this.route.snapshot.paramMap.get('pubkey') ?? '';

  readonly me = toSignal(this.identity.currentUser$, { initialValue: null });
  readonly messages = toSignal(this.storage.getMessages(this.recipientPubkey) ?? EMPTY, {
    initialValue: [] as MessageDoc[],
  });

  private readonly contactsList = toSignal(this.storage.getContacts() ?? EMPTY, {
    initialValue: [] as ContactDoc[],
  });

  readonly contact = computed(
    () => this.contactsList().find((c) => c.pubkey === this.recipientPubkey) ?? null,
  );

  readonly newMessage = signal('');
  readonly sending = signal(false);

  constructor() {
    addIcons({ sendOutline });

    effect(() => {
      this.messages();
      untracked(() => {
        setTimeout(() => this.content()?.scrollToBottom(0), 50);
      });
    });
  }

  async send(): Promise<void> {
    const text = this.newMessage().trim();
    const me = this.me();
    if (!text || !this.recipientPubkey || !me || this.sending()) return;

    this.sending.set(true);
    try {
      const capsule = await this.capsuleSvc.build({
        kind: CapsuleKind.DIRECT_MESSAGE,
        plaintextContent: text,
        recipientPubkeyHex: this.recipientPubkey,
      });

      this.relayPool.publish(capsule);

      await this.storage.addMessage({
        id: capsule.id,
        senderId: me.id,
        receiverId: this.recipientPubkey,
        text,
        timestamp: capsule.created_at * 1000,
        status: 'sent',
        kind: capsule.kind,
        capsuleTags: capsule.tags,
      });

      this.newMessage.set('');
    } catch (e) {
      console.error('[Dialog] send failed:', e);
    } finally {
      this.sending.set(false);
    }
  }

  isMine(msg: MessageDoc): boolean {
    return msg.senderId === this.me()?.id;
  }

  // TODO: переиспользовать пайп, проверить другие компоненты
  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
