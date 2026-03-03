import { Injectable, inject } from '@angular/core';
import { IdentityService } from './identity.service';
import { EventProcessorService } from './event-processor.service';
import { SignedEvent } from '../models/event.model';

@Injectable({ providedIn: 'root' })
export class RelayPoolService {
  private identity = inject(IdentityService);
  private eventProcessor = inject(EventProcessorService);

  private ws: WebSocket | null = null;
  private readonly RELAY_URL = 'ws://localhost:8080';

  constructor() {
    this.connect();
  }

  private connect(): void {
    this.ws = new WebSocket(this.RELAY_URL);
    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (msg) => this.onMessage(msg);
    this.ws.onclose = () => setTimeout(() => this.connect(), 5000);
  }

  private onOpen(): void {
    const user = this.identity.getUser();
    if (user) {
      this.requestHistory(user.id);
    }
  }

  private async onMessage(msg: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(msg.data);
      if (data[0] === 'EVENT') {
        const event = data[2] as SignedEvent;
        const user = this.identity.getUser();
        if (user) {
          await this.eventProcessor.processIncomingEvent(event, user.id, user.keyPair);
        }
      }
    } catch (e) {
      console.error('Error processing relay message', e);
    }
  }

  publish(event: SignedEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['EVENT', event]));
    }
  }

  requestHistory(myPubKey: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['REQ', 'history', { '#p': [myPubKey] }]));
    }
  }
}
