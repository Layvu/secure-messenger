import { Injectable } from '@angular/core';
import { CameraService } from './camera.service';

// TODO: много заглушек
@Injectable()
export class WebCameraService extends CameraService {
  async takePhoto(): Promise<string | null> {
    return this.pickFile('image/*;capture=environment');
  }

  async pickFromGallery(): Promise<string | null> {
    return this.pickFile('image/*');
  }

  async startQrStream(videoEl: HTMLVideoElement): Promise<() => void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    return () => {
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    };
  }

  private pickFile(accept: string): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
}
