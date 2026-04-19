import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { IdentityService } from '../../core/services/identity.service';
import { StorageService } from '../../core/services/storage.service';
import { RelayPoolService } from '../../core/services/relay-pool.service';

@Component({
  selector: 'app-unlock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unlock.component.html',
  styleUrls: ['./unlock.component.scss'],
})
export class UnlockComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly identity = inject(IdentityService);
  private readonly storage = inject(StorageService);
  private readonly relayPool = inject(RelayPoolService);

  pin = signal('');
  error = signal('');
  loading = signal(false);
  attempts = signal(0);

  async unlock(): Promise<void> {
    const pinValue = this.pin();
    if (pinValue.length !== 6 || !/^\d{6}$/.test(pinValue)) {
      this.error.set('Введите 6-значный PIN');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    try {
      const result = await this.identity.unlockWithPin(pinValue);

      if (!result) {
        this.attempts.update((n) => n + 1);
        this.error.set(
          `Неверный PIN${this.attempts() >= 3 ? '. Данные нельзя восстановить без PIN' : ''}`,
        );
        this.pin.set('');
        return;
      }

      await this.storage.initDB(result.userId, result.encKey);

      const identityDoc = await this.storage.getIdentity();
      if (identityDoc) this.identity.setUsername(identityDoc.username);

      this.relayPool.notifyUserLoggedIn();

      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/chats';
      await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    } catch (e) {
      console.error('[Unlock]', e);
      this.error.set('Ошибка разблокировки. Попробуйте ещё раз.');
    } finally {
      this.loading.set(false);
    }
  }

  goToOnboarding(): void {
    this.router.navigate(['/onboarding'], { replaceUrl: true });
  }
}
