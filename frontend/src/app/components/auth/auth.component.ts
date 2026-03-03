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
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
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
  }

  private async initDatabase(user: UserProfile) {
    const privateKeyHex = this.crypto.toHex(user.keyPair.privateKey);
    const dbKey = this.crypto.hashHex(privateKeyHex);
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
