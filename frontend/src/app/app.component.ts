import { Component, OnInit, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { StorageService } from './core/services/storage.service';

const SS_RECOVERY_PENDING = 'dm_recovery_pending';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  templateUrl: './app.html',
})
export class AppComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);

  async ngOnInit(): Promise<void> {
    if (sessionStorage.getItem(SS_RECOVERY_PENDING) !== '1') return;

    const userId = sessionStorage.getItem('dm_recovery_user_id') ?? '';
    const encKey = sessionStorage.getItem('dm_recovery_enc_key') ?? '';
    if (userId && encKey) {
      await this.storage.initDB(userId, encKey);
    }
    await this.router.navigate(['/unlock'], { replaceUrl: true });
  }
}
