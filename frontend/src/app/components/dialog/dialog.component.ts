import {
  Component,
  OnInit,
  AfterViewChecked,
  signal,
  DestroyRef,
  inject,
  ViewChild,
} from '@angular/core';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IdentityService, UserProfile } from '../../core/services/identity.service';
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
export class DialogComponent implements OnInit, AfterViewChecked {
  @ViewChild(IonContent) private content!: IonContent;

  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private identity = inject(IdentityService);
  private storage = inject(StorageService);
  private capsuleSvc = inject(CapsuleService);
  private relayPool = inject(RelayPoolService);

  me = signal<UserProfile | null>(null);
  contact = signal<ContactDoc | null>(null);
  messages = signal<MessageDoc[]>([]);
  newMessage = signal('');
  sending = signal(false);

  private recipientPubkey = '';
  private shouldScrollToBottom = false;

  constructor() {
    addIcons({ sendOutline });
  }

  ngOnInit(): void {
    this.recipientPubkey = this.route.snapshot.paramMap.get('pubkey') ?? '';

    // TODO: перейти на async и свежий синтаксис без кучи подписок
    this.identity.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((u) => this.me.set(u));

    this.storage.getContact(this.recipientPubkey).then((c) => this.contact.set(c));

    const stream = this.storage.getMessages(this.recipientPubkey);
    if (stream) {
      stream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((msgs) => {
        this.messages.set(msgs);
        this.shouldScrollToBottom = true;
      });
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.content?.scrollToBottom(0);
      this.shouldScrollToBottom = false;
    }
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
