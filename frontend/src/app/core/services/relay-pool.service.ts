import { SignedCapsule } from '../models/capsule.model';

export abstract class RelayPoolService {
  abstract connect(): void;
  abstract disconnect(): void;
  abstract publish(capsule: SignedCapsule): void;
  abstract requestHistory(myPubKey: string, since?: number): void;
  abstract notifyUserLoggedIn(): void;
}
