import { Injectable } from '@angular/core';

export abstract class PushService {
  abstract requestPermission(): Promise<boolean>;
  abstract isSupported(): boolean;
}

// TODO: заглушка
@Injectable()
export class StubPushService extends PushService {
  isSupported(): boolean {
    return false;
  }
  async requestPermission(): Promise<boolean> {
    return false;
  }
}
