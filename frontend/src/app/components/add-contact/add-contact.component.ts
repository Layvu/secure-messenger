import {
  Component,
  signal,
  inject,
  viewChild,
  ElementRef,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
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
  IonSpinner,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import jsQR from 'jsqr';

import { StorageService } from '../../core/services/storage.service';
import { ContactService } from '../../core/services/contact.service';
import { CameraService } from '../../core/services/camera.service';

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
    IonSpinner,
  ],
  templateUrl: './add-contact.component.html',
  styleUrls: ['./add-contact.component.scss'],
})
export class AddContactComponent {
  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly canvasEl = viewChild<ElementRef<HTMLCanvasElement>>('canvasEl');

  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private readonly contactSvc = inject(ContactService);
  private readonly camera = inject(CameraService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pubkey = signal('');
  readonly username = signal('');
  readonly error = signal('');
  readonly saving = signal(false);
  readonly scanning = signal(false);
  readonly scanError = signal('');

  private stopStreamFn: (() => void) | null = null;
  private animFrameId: number | null = null;

  constructor() {
    effect(() => {
      const video = this.videoEl()?.nativeElement;
      if (this.scanning() && video) {
        untracked(() => this.beginScanLoop(video));
      }
    });

    this.destroyRef.onDestroy(() => this.stopScanner());
  }

  async toggleScanner(): Promise<void> {
    if (this.scanning()) {
      this.stopScanner();
    } else {
      this.scanError.set('');
      this.scanning.set(true);
    }
  }

  async save(): Promise<void> {
    const pubkey = this.pubkey().trim().toLowerCase();
    const username = this.username().trim();

    if (!pubkey || pubkey.length !== 64) {
      this.error.set('Введите корректный публичный ключ (64 символа hex)');
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

  private stopScanner(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.stopStreamFn?.();
    this.stopStreamFn = null;
    this.scanning.set(false);
  }

  private async beginScanLoop(videoEl: HTMLVideoElement): Promise<void> {
    try {
      this.stopStreamFn = await this.camera.startQrStream(videoEl);
    } catch (e) {
      console.error('[Scanner] camera error:', e);
      this.scanError.set('Не удалось получить доступ к камере');
      this.scanning.set(false);
      return;
    }
    this.tick();
  }

  private tick(): void {
    const video = this.videoEl()?.nativeElement;
    const canvas = this.canvasEl()?.nativeElement;
    if (!video || !canvas || !this.scanning()) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          this.stopScanner();
          this.onQrDetected(code.data);
          return;
        }
      }
    }

    this.animFrameId = requestAnimationFrame(() => this.tick());
  }

  private onQrDetected(raw: string): void {
    const invite = this.contactSvc.parseInvite(raw);
    if (invite) {
      const params: Record<string, string> = { pubkey: invite.pubkey };
      this.router.navigate(['/add'], { queryParams: params });
    } else {
      this.scanError.set('QR-код не является invite-ссылкой D-Messenger');
    }
  }
}
