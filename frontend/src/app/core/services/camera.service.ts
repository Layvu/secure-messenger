import { Injectable } from '@angular/core';

export abstract class CameraService {
  abstract takePhoto(): Promise<string | null>;
  abstract pickFromGallery(): Promise<string | null>;
  abstract startQrStream(videoEl: HTMLVideoElement): Promise<() => void>;
}

// TODO: один экспорт класса на файл
// TODO: заглушка
@Injectable()
export class StubCameraService extends CameraService {
  async takePhoto(): Promise<string | null> {
    return null;
  }
  async pickFromGallery(): Promise<string | null> {
    return null;
  }
  async startQrStream(_videoEl: HTMLVideoElement): Promise<() => void> {
    return () => {};
  }
}
