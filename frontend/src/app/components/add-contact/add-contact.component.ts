import { Component, signal, inject } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonNote,
  IonTextarea,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-add-contact',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonNote,
    IonTextarea,
  ],
  templateUrl: './add-contact.component.html',
  styleUrls: ['./add-contact.component.scss'],
})
export class AddContactComponent {
  private storage = inject(StorageService);
  private router = inject(Router);

  pubkey = signal('');
  username = signal('');
  error = signal('');
  saving = signal(false);

  async save(): Promise<void> {
    const pubkey = this.pubkey().trim().toLowerCase();
    const username = this.username().trim();

    if (!pubkey || pubkey.length < 64) {
      this.error.set('Введите корректный публичный ключ (64+ символа hex)');
      return;
    }
    if (!/^[0-9a-f]+$/.test(pubkey)) {
      this.error.set('Ключ должен содержать только hex-символы (0–9, a–f)');
      return;
    }
    if (!username) {
      this.error.set('Введите имя контакта');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    try {
      const existing = await this.storage.getContact(pubkey);
      if (existing) {
        this.error.set('Контакт уже существует');
        return;
      }

      await this.storage.upsertContact({ pubkey, username, relays: [] });
      await this.router.navigate(['/chats', pubkey], { replaceUrl: false });
    } catch (e) {
      console.error('[AddContact]', e);
      this.error.set('Ошибка при сохранении. Попробуйте ещё раз.');
    } finally {
      this.saving.set(false);
    }
  }
}
