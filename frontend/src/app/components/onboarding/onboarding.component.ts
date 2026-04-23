import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CryptoService } from '../../core/services/crypto.service';
import { IdentityService } from '../../core/services/identity.service';
import { StorageService } from '../../core/services/storage.service';
import { RelayPoolService } from '../../core/services/relay-pool.service';

type OnboardingStep =
  | 'choose'
  | 'show-mnemonic'
  | 'verify-mnemonic'
  | 'enter-mnemonic'
  | 'set-pin'
  | 'loading';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding.component.html',
  styleUrls: ['./onboarding.component.scss'],
})
export class OnboardingComponent {
  private readonly router = inject(Router);
  private readonly crypto = inject(CryptoService);
  private readonly identity = inject(IdentityService);
  private readonly storage = inject(StorageService);
  private readonly relayPool = inject(RelayPoolService);

  readonly step = signal<OnboardingStep>('choose');

  readonly username = signal('');
  readonly generatedMnemonic = signal('');
  readonly mnemonicWords = computed(() => this.generatedMnemonic().split(' '));

  readonly verifyIndices = signal<number[]>([]);
  readonly verifyAnswers = signal<string[]>(['', '', '']);
  readonly verifyError = signal(false);

  readonly restoreMnemonic = signal('');
  readonly restoreError = signal('');

  readonly pin1 = signal('');
  readonly pin2 = signal('');
  readonly pinError = signal('');
  readonly loadingError = signal('');

  async chooseCreate(): Promise<void> {
    if (!this.username().trim()) return;
    const { mnemonic } = await this.identity.createNewAccount(this.username().trim());

    console.log('Мнемоническая фраза (12 слов):', mnemonic);

    this.generatedMnemonic.set(mnemonic);
    this.verifyIndices.set(this.pickRandomIndices(12, 3));
    this.verifyAnswers.set(['', '', '']);
    this.step.set('show-mnemonic');
  }

  chooseRestore(): void {
    this.restoreMnemonic.set('');
    this.restoreError.set('');
    this.step.set('enter-mnemonic');
  }

  proceedToVerify(): void {
    this.verifyError.set(false);
    this.step.set('verify-mnemonic');
  }

  submitVerification(): void {
    const words = this.mnemonicWords();
    const answers = this.verifyAnswers();
    const indices = this.verifyIndices();
    const allCorrect = indices.every(
      (idx, i) => answers[i].trim().toLowerCase() === words[idx].toLowerCase(),
    );
    if (!allCorrect) {
      this.verifyError.set(true);
      return;
    }
    this.step.set('set-pin');
  }

  setVerifyAnswer(i: number, value: string): void {
    const arr = [...this.verifyAnswers()];
    arr[i] = value;
    this.verifyAnswers.set(arr);
    this.verifyError.set(false);
  }

  submitRestoreMnemonic(): void {
    const words = this.restoreMnemonic().trim().split(/\s+/);
    if (words.length !== 12) {
      this.restoreError.set('Введите 12 слов');
      return;
    }
    if (!this.crypto.validateMnemonic(this.restoreMnemonic().trim())) {
      this.restoreError.set('Неверная мнемоническая фраза');
      return;
    }
    this.restoreError.set('');
    this.step.set('set-pin');
  }

  async submitPin(): Promise<void> {
    const p1 = this.pin1();
    const p2 = this.pin2();

    if (p1.length !== 6 || !/^\d{6}$/.test(p1)) {
      this.pinError.set('PIN должен состоять из 6 цифр');
      return;
    }
    if (p1 !== p2) {
      this.pinError.set('PIN-коды не совпадают');
      return;
    }

    this.pinError.set('');
    this.step.set('loading');
    this.loadingError.set('');

    try {
      const isRecovery = this.isRestoreFlow();
      const mnemonic = isRecovery ? this.restoreMnemonic().trim() : this.generatedMnemonic();
      const uname = this.username().trim() || 'User'; // TODO: имя должно быть всегда задано пользователем

      const { encKey, userId } = await this.identity.saveAccountWithPin(mnemonic, uname, p1);

      await this.storage.initDB(userId, encKey, isRecovery);
      await this.storage.upsertIdentity({
        id: 'local',
        pubkey: userId,
        username: uname,
        relays: [],
      });

      this.relayPool.notifyUserLoggedIn();
      await this.router.navigate(['/chats'], { replaceUrl: true });
    } catch (e) {
      console.error('[Onboarding] save failed:', e);
      this.loadingError.set('Ошибка при создании аккаунта. Попробуйте ещё раз');
      this.step.set('set-pin');
    }
  }

  // Utils

  isRestoreFlow(): boolean {
    return this.restoreMnemonic().length > 0;
  }

  private pickRandomIndices(total: number, count: number): number[] {
    const all = Array.from({ length: total }, (_, i) => i);
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count).sort((a, b) => a - b);
  }
}
