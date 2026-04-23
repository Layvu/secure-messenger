import { Component, OnInit, signal, inject } from '@angular/core';
import { IonContent, IonSpinner, IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline, closeCircleOutline } from 'ionicons/icons';
import { ActivatedRoute, Router } from '@angular/router';

import { StorageService } from '../../core/services/storage.service';
import { ContactService } from '../../core/services/contact.service';

type State = 'loading' | 'success' | 'already' | 'error';

@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [IonContent, IonSpinner, IonButton, IonIcon],
  templateUrl: './accept-invite.component.html',
  styleUrl: './accept-invite.component.scss',
})
export class AcceptInviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly contactSvc = inject(ContactService);

  readonly state = signal<State>('loading');
  readonly contactName = signal('Контакт');
  readonly errorMsg = signal('Некорректная ссылка');

  async ngOnInit(): Promise<void> {
    addIcons({ checkmarkCircleOutline, closeCircleOutline });

    const pubkey = this.route.snapshot.queryParamMap.get('pubkey');
    const name = this.route.snapshot.queryParamMap.get('name');

    const invite = pubkey
      ? this.contactSvc.parseInvite(
          `${window.location.origin}/add?pubkey=${pubkey}${name ? `&name=${encodeURIComponent(name)}` : ''}`,
        )
      : null;

    if (!invite) {
      this.errorMsg.set('Некорректная invite-ссылка');
      this.state.set('error');
      return;
    }

    const displayName = `${invite.pubkey.slice(0, 8)}…`;
    this.contactName.set(displayName);

    try {
      const existing = await this.storage.getContact(invite.pubkey);

      if (!existing) {
        await this.storage.upsertContact({
          pubkey: invite.pubkey,
          username: displayName,
          relays: invite.relays,
        });
      }

      await this.contactSvc.publishProfileUpdateTo(invite.pubkey);

      this.state.set(existing ? 'already' : 'success');
      setTimeout(() => {
        this.router.navigate(['/chats', invite.pubkey], { replaceUrl: true });
      }, 800);
    } catch (e) {
      console.error('[AcceptInvite]', e);
      this.errorMsg.set('Не удалось добавить контакт');
      this.state.set('error');
    }
  }

  goBack(): void {
    this.router.navigate(['/chats']);
  }
}
