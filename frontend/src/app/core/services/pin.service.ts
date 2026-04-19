export abstract class PinService {
  abstract deriveKey(pin: string, saltHex: string): Promise<Uint8Array>;
  abstract generateSalt(): string;
  abstract keyToHex(key: Uint8Array): string;
}
