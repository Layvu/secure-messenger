import { Signal } from '@angular/core';
import { SignedCapsule } from '../models/capsule.model';
import { RelayInfo } from '../models/relay.model';

export abstract class RelayPoolService {
  abstract connect(): void;
  abstract disconnect(): void;
  abstract publish(capsule: SignedCapsule): void;
  abstract requestHistory(myPubKey: string, since?: number): void;
  abstract notifyUserLoggedIn(): void;
  abstract readonly relays: Signal<RelayInfo[]>;
}
