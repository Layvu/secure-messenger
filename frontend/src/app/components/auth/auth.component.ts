import { Component, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdentityService, UserProfile } from '../../core/services/identity.service';
import { CryptoService } from '../../core/services/crypto.service';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-container">
      <h2>Регистрация</h2>

      @if (!isRegistered()) {
        <input [(ngModel)]="username" placeholder="Ваше имя" />
        <button (click)="register()">Создать аккаунт</button>
      } @else {
        @if (user()) {
          <h3>Аккаунт создан</h3>
          <p><strong>Имя:</strong> {{ user()?.username }}</p>
          <p><strong>Public Key:</strong></p>
          <div class="key-box">
            <code>{{ user()?.id }}</code>
            <button (click)="copyKey()">Копировать ключ</button>
          </div>
          @if (copied()) {
            <p class="success">Ключ скопирован!</p>
          }

          <h4>Мнемоническая фраза (сохраните!):</h4>
          <div class="key-box">
            <code>{{ mnemonic() }}</code>
          </div>

          <button (click)="complete()">Перейти к чату</button>
        }
      }
    </div>
  `,
  styles: [
    `
      .auth-container {
        max-width: 500px;
        margin: 50px auto;
        padding: 20px;
      }
      .key-box {
        background: #f5f5f5;
        padding: 10px;
        margin: 10px 0;
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .key-box code {
        flex: 1;
        word-break: break-all;
        font-size: 12px;
      }
      .success {
        color: green;
      }
      input {
        padding: 10px;
        margin: 10px 0;
        width: 100%;
        box-sizing: border-box;
      }
      button {
        padding: 10px 20px;
        margin: 5px;
        cursor: pointer;
      }
    `,
  ],
})
export class AuthComponent {
  readonly authComplete = output<void>();

  username = signal('');
  isRegistered = signal(false);
  mnemonic = signal('');
  user = signal<UserProfile | null>(null);
  copied = signal(false);

  constructor(
    private identity: IdentityService,
    private crypto: CryptoService,
    private storage: StorageService,
  ) {}

  async register() {
    if (!this.username()) return;

    await this.crypto.init();
    const mnemonic = await this.identity.createNewAccount(this.username());
    const user = this.identity.getUser()!;

    this.mnemonic.set(mnemonic);
    this.user.set(user);
    this.isRegistered.set(true);

    await this.initDatabase(user);

    console.log('Registration complete:', user.id);
  }

  private async initDatabase(user: UserProfile) {
    const dbKey = this.crypto.hash(this.crypto.toHex(user.keyPair.privateKey));
    await this.storage.initDB(user.id, dbKey);
  }

  copyKey() {
    const user = this.user();
    if (user) {
      navigator.clipboard.writeText(user.id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  complete() {
    this.authComplete.emit();
  }
}
