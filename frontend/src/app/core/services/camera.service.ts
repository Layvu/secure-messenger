import { Injectable } from '@angular/core';

export abstract class CameraService {
  abstract takePhoto(): Promise<string | null>;
  abstract pickFromGallery(): Promise<string | null>;
}

// TODO: заглушка
@Injectable()
export class StubCameraService extends CameraService {
  async takePhoto(): Promise<string | null> {
    return null;
  }
  async pickFromGallery(): Promise<string | null> {
    return null;
  }
}
