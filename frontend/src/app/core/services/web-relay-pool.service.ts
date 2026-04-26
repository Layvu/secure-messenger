import { Injectable, inject, NgZone, DestroyRef, signal, Signal } from '@angular/core';
import { IdentityService } from './identity.service';
import { EventProcessorService } from './event-processor.service';
import { RelayPoolService } from './relay-pool.service';
import { StorageService } from './storage.service';
import { LocalStorageService } from './local-storage.service';
import { SignedCapsule, CapsuleKind } from '../models/capsule.model';
import { RelayInfo } from '../models/relay.model';
import { environment } from '../../../environments/environment';

const DAG_SUB_PREFIX = 'dag_';
const SEEN_MAX_SIZE = 2000;
const DAG_REQUESTED_MAX_SIZE = 500;
const MAX_ACTIVE_RELAYS = 3;
const MAX_KNOWN_RELAYS = 20;
const PING_INTERVAL_MS = 5 * 60 * 1000;
const LS_RELAY_CACHE_KEY = 'dm_relay_cache';
const OUTBOX_MAX_SIZE = 50; // капсул в очереди повтора

interface RelayConn {
  url: string;
  ws: WebSocket | null;
  latency: number | null;
  connectStartTime: number;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class WebRelayPoolService extends RelayPoolService {
  private readonly identity = inject(IdentityService);
  private readonly eventProcessor = inject(EventProcessorService);
  private readonly storage = inject(StorageService);
  private readonly ls = inject(LocalStorageService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly connections = new Map<string, RelayConn>();
  private readonly seen = new Set<string>();
  private readonly dagRequested = new Set<string>();
  private readonly outbox: string[] = []; // Очередь капсул на случай кратковременного отсутствия активных соединений

  private readonly _relays = signal<RelayInfo[]>([]);
  readonly relays: Signal<RelayInfo[]> = this._relays;

  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.initRelays();
    this.startPingLoop();
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  connect(): void {
    for (const conn of this.connections.values()) {
      if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED) {
        this.connectRelay(conn);
      }
    }
  }

  disconnect(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const conn of this.connections.values()) {
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      conn.ws?.close();
      conn.ws = null;
      conn.reconnectAttempt = 0;
    }
    this.refreshStats();
  }

  publish(capsule: SignedCapsule): void {
    const open = this.getOpenConns();
    const data = JSON.stringify(['EVENT', capsule]);

    if (open.length === 0) {
      console.warn('[RelayPool] no open relays, queuing capsule');
      if (this.outbox.length < OUTBOX_MAX_SIZE) this.outbox.push(data);
      return;
    }

    for (const conn of open) this.send(conn, data);
  }

  requestHistory(myPubKey: string, since?: number): void {
    const filter: Record<string, unknown> = { '#p': [myPubKey] };
    if (since && since > 0) filter['since'] = since;
    const data = JSON.stringify(['REQ', 'initial_sync', filter]);
    for (const conn of this.connections.values()) {
      this.send(conn, data);
    }
  }

  notifyUserLoggedIn(): void {
    const user = this.identity.getUser();
    if (!user) return;

    const since = this.identity.getLastOnlineTimestamp();
    console.log(`[RelayPool] requesting history since ${since || 'beginning'}`);
    this.requestHistory(user.id, since);
  }

  private initRelays(): void {
    for (const url of this.loadCachedUrls()) {
      this.addRelay(url);
    }
  }

  private loadCachedUrls(): string[] {
    const raw = this.ls.get(LS_RELAY_CACHE_KEY);
    if (raw) {
      try {
        const urls = JSON.parse(raw) as unknown;
        if (Array.isArray(urls) && urls.length > 0) {
          return (urls as string[]).filter((u) => typeof u === 'string');
        }
      } catch {
        /* TODO: fall through */
      }
    }
    return [environment.relayUrl];
  }

  private saveCachedUrls(): void {
    this.ls.set(LS_RELAY_CACHE_KEY, JSON.stringify(Array.from(this.connections.keys())));
  }

  private addRelay(url: string): void {
    if (this.connections.has(url) || this.connections.size >= MAX_KNOWN_RELAYS) return;
    const conn: RelayConn = {
      url,
      ws: null,
      latency: null,
      connectStartTime: 0,
      reconnectAttempt: 0,
      reconnectTimer: null,
    };
    this.connections.set(url, conn);
    this.connectRelay(conn);
    this.refreshStats();
  }

  private connectRelay(conn: RelayConn): void {
    if (conn.ws?.readyState === WebSocket.OPEN || conn.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    conn.connectStartTime = Date.now();
    conn.ws = this.zone.runOutsideAngular(() => new WebSocket(conn.url));
    conn.ws.onopen = () => this.zone.run(() => this.onOpen(conn));
    conn.ws.onmessage = (msg) => this.onMessage(conn, msg);
    conn.ws.onerror = () => {};
    conn.ws.onclose = () => this.zone.run(() => this.onClose(conn));

    this.refreshStats();
  }

  private onOpen(conn: RelayConn): void {
    conn.latency = Date.now() - conn.connectStartTime;
    conn.reconnectAttempt = 0;
    console.log(`[RelayPool] connected to ${conn.url} (${conn.latency}ms)`);
    this.refreshStats();

    this.send(conn, JSON.stringify(['REQ', 'give_me_peers', {}]));

    const user = this.identity.getUser();
    if (user) {
      const since = this.identity.getLastOnlineTimestamp();
      const filter: Record<string, unknown> = { '#p': [user.id] };
      if (since && since > 0) filter['since'] = since;
      this.send(conn, JSON.stringify(['REQ', 'initial_sync', filter]));
    }

    this.flushOutbox(conn);
  }

  private onClose(conn: RelayConn): void {
    conn.ws = null;
    conn.latency = null;
    const delay = Math.min(1000 * Math.pow(2, conn.reconnectAttempt), 60_000);
    conn.reconnectAttempt++;
    console.warn(`[RelayPool] disconnected from ${conn.url}, retry in ${delay / 1000}s`);
    conn.reconnectTimer = setTimeout(() => this.connectRelay(conn), delay);
    this.refreshStats();
  }

  private flushOutbox(conn: RelayConn): void {
    if (this.outbox.length === 0) return;
    console.log(`[RelayPool] flushing ${this.outbox.length} queued capsule(s) to ${conn.url}`);
    const items = this.outbox.splice(0);
    for (const data of items) this.send(conn, data);
  }

  private async onMessage(conn: RelayConn, msg: MessageEvent): Promise<void> {
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

        if (capsule.kind === CapsuleKind.PEER_DISCOVERY) {
          this.zone.run(() => this.handlePex(capsule));
          return;
        }

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

        if (this.isSystemCapsule(capsule)) {
          return;
        }

        const user = this.identity.getUser();
        if (!user) return;

        await this.zone.run(() =>
          this.eventProcessor.processIncomingCapsule(capsule, user.id, user.keyPair),
        );
        break;
      }

      case 'OK': {
        const [, id, ok, reason] = data as [string, string, boolean, string];
        if (!ok) {
          console.warn(`[RelayPool] capsule rejected (${conn.url}): ${id} — ${reason}`);
        }
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

  private handlePex(capsule: SignedCapsule): void {
    try {
      const peers = JSON.parse(capsule.content) as unknown;
      if (!Array.isArray(peers)) return;

      let added = false;
      for (const url of peers as string[]) {
        if (typeof url === 'string' && (url.startsWith('ws://') || url.startsWith('wss://'))) {
          if (!this.connections.has(url)) {
            this.addRelay(url);
            added = true;
          }
        }
      }
      if (added) {
        this.saveCachedUrls();
        console.log(`[RelayPool] PEX: added new peers`);
      }
    } catch {
      /* TODO: ignore malformed */
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

      const req = JSON.stringify(['REQ', `${DAG_SUB_PREFIX}${refId.slice(0, 8)}`, { id: refId }]);
      for (const conn of this.connections.values()) this.send(conn, req);
    }
  }

  // Helpers

  private getOpenConns(): RelayConn[] {
    return Array.from(this.connections.values()).filter((c) => c.ws?.readyState === WebSocket.OPEN);
  }

  private getTopConns(): RelayConn[] {
    return this.getOpenConns()
      .sort((a, b) => {
        if (a.latency === null) return 1;
        if (b.latency === null) return -1;
        return a.latency - b.latency;
      })
      .slice(0, MAX_ACTIVE_RELAYS);
  }

  private refreshStats(): void {
    const activeUrls = new Set(this.getTopConns().map((c) => c.url));
    this._relays.set(
      Array.from(this.connections.values()).map((conn) => ({
        url: conn.url,
        latency: conn.latency,
        isActive: activeUrls.has(conn.url),
        status: !conn.ws
          ? 'disconnected'
          : conn.ws.readyState === WebSocket.OPEN
            ? 'connected'
            : conn.ws.readyState === WebSocket.CONNECTING
              ? 'connecting'
              : 'disconnected',
      })),
    );
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      this.zone.run(() => {
        for (const conn of this.connections.values()) {
          if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED) {
            if (!conn.reconnectTimer) this.connectRelay(conn);
          }
        }
        this.refreshStats();
      });
    }, PING_INTERVAL_MS);

    this.destroyRef.onDestroy(() => {
      if (this.pingTimer) clearInterval(this.pingTimer);
    });
  }

  private send(conn: RelayConn, data: string): void {
    if (conn.ws?.readyState === WebSocket.OPEN) conn.ws.send(data);
  }

  private isSystemCapsule(capsule: SignedCapsule): boolean {
    return (
      capsule.kind === CapsuleKind.RELAY_HEARTBEAT || capsule.kind === CapsuleKind.PEER_DISCOVERY
    );
  }
}
