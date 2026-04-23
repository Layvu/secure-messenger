import { Injectable, inject, NgZone, DestroyRef } from '@angular/core';
import { IdentityService } from './identity.service';
import { EventProcessorService } from './event-processor.service';
import { RelayPoolService } from './relay-pool.service';
import { StorageService } from './storage.service';
import { SignedCapsule, CapsuleKind } from '../models/capsule.model';
import { environment } from '../../../environments/environment';

const DAG_SUB_PREFIX = 'dag_';
const SEEN_MAX_SIZE = 2000; // максимальный размер кэша дедупликации
const DAG_REQUESTED_MAX_SIZE = 500;

@Injectable()
export class WebRelayPoolService extends RelayPoolService {
  private readonly identity = inject(IdentityService);
  private readonly eventProcessor = inject(EventProcessorService);
  private readonly storage = inject(StorageService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectAttempt = 0;
  private readonly RECONNECT_BASE_MS = 1_000;
  private readonly RECONNECT_MAX_MS = 60_000;
  private readonly RECONNECT_FACTOR = 2;

  private readonly RELAY_URL = this.resolveRelayUrl();

  private readonly seen = new Set<string>();
  private readonly dagRequested = new Set<string>();

  constructor() {
    super();
    this.connect();

    this.destroyRef.onDestroy(() => this.disconnect());
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
      return;

    console.log(
      `[RelayPool] connecting to ${this.RELAY_URL} (attempt ${this.reconnectAttempt + 1})`,
    );

    this.ws = this.zone.runOutsideAngular(() => new WebSocket(this.RELAY_URL));
    this.ws.onopen = () => this.zone.run(() => this.onOpen());
    this.ws.onmessage = (msg) => this.onMessage(msg);
    this.ws.onerror = () => {};
    this.ws.onclose = () => this.zone.run(() => this.onClose());
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.reconnectAttempt = 0;
  }

  publish(capsule: SignedCapsule): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['EVENT', capsule]));
    } else {
      console.warn('[RelayPool] not connected, capsule dropped');
    }
  }

  requestHistory(myPubKey: string, since?: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const filter: Record<string, unknown> = { '#p': [myPubKey] };
    if (since && since > 0) filter['since'] = since;
    this.ws.send(JSON.stringify(['REQ', 'initial_sync', filter]));
  }

  notifyUserLoggedIn(): void {
    const user = this.identity.getUser();
    if (!user) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      const since = this.identity.getLastOnlineTimestamp();
      console.log(`[RelayPool] requesting history since ${since || 'beginning'}`);
      this.requestHistory(user.id, since);
    }
  }

  private onOpen(): void {
    this.reconnectAttempt = 0;
    this.seen.clear();
    this.dagRequested.clear();
    console.log(`[RelayPool] connected to ${this.RELAY_URL}`);
    this.notifyUserLoggedIn();
  }

  private onClose(): void {
    this.ws = null;
    const delay = Math.min(
      this.RECONNECT_BASE_MS * Math.pow(this.RECONNECT_FACTOR, this.reconnectAttempt),
      this.RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;
    console.warn(`[RelayPool] disconnected, reconnecting in ${delay / 1000}s…`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private async onMessage(msg: MessageEvent): Promise<void> {
    let data: unknown[];
    try {
      data = JSON.parse(msg.data as string) as unknown[];
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;

    const type = data[0] as string;

    switch (type) {
      case 'EVENT': {
        const subId = data[1] as string;
        const capsule = data[2] as SignedCapsule;
        if (!capsule?.id) return;

        await this.checkDagGaps(capsule);

        const isDagRecovery = subId.startsWith(DAG_SUB_PREFIX);

        if (!isDagRecovery) {
          if (this.seen.has(capsule.id)) return;
          this.seen.add(capsule.id);
          if (this.seen.size > SEEN_MAX_SIZE) {
            const first = this.seen.values().next().value;
            if (first) this.seen.delete(first);
          }
        }

        if (this.isRelaySystemCapsule(capsule)) return;

        const user = this.identity.getUser();
        if (!user) return;

        await this.zone.run(() =>
          this.eventProcessor.processIncomingCapsule(capsule, user.id, user.keyPair),
        );
        break;
      }

      case 'OK': {
        const [, id, ok, reason] = data as [string, string, boolean, string];
        if (!ok) console.warn(`[RelayPool] capsule rejected: ${id} — ${reason}`);
        break;
      }

      case 'EOSE': {
        const subId = data[1] as string;
        if (subId === 'initial_sync') {
          this.zone.run(() => this.identity.markOnlineNow());
        }
        break;
      }
    }
  }

  private async checkDagGaps(capsule: SignedCapsule): Promise<void> {
    const eTag = capsule.tags.find((t) => t[0] === 'e');
    if (!eTag || eTag.length < 2) return;

    for (const refId of eTag.slice(1)) {
      if (!refId || this.dagRequested.has(refId)) continue;

      const exists = await this.storage.hasMessage(refId);
      if (exists) continue;

      this.dagRequested.add(refId);
      if (this.dagRequested.size > DAG_REQUESTED_MAX_SIZE) {
        const first = this.dagRequested.values().next().value;
        if (first) this.dagRequested.delete(first);
      }

      console.log(`[RelayPool] DAG gap detected, requesting: ${refId.slice(0, 12)}…`);
      this.requestById(refId);
    }
  }

  private requestById(id: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(['REQ', `${DAG_SUB_PREFIX}${id.slice(0, 8)}`, { id }]));
  }

  private isRelaySystemCapsule(capsule: SignedCapsule): boolean {
    return (
      capsule.kind === CapsuleKind.RELAY_HEARTBEAT || capsule.kind === CapsuleKind.PEER_DISCOVERY
    );
  }

  private resolveRelayUrl(): string {
    // TODO: читать из LocalStorage (кэш известных реле), проверить на мультиплатформенность
    return (
      ((window as unknown as Record<string, unknown>)['DM_RELAY_URL'] as string) ??
      environment.relayUrl
    );
  }
}
