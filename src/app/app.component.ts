import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthComponent } from './components/auth/auth.component';
import { ChatComponent } from './components/chat/chat.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AuthComponent, ChatComponent],
  template: `
    <h1>Secure Messenger v1.2</h1>

    @if (!isLoggedIn) {
      <app-auth (authComplete)="onAuthComplete()"></app-auth>
    } @else {
      <app-chat></app-chat>
    }
  `,
})
export class AppComponent {
  isLoggedIn = false;

  onAuthComplete() {
    this.isLoggedIn = true;
  }
}
