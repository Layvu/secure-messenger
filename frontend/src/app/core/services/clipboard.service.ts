import { Injectable } from '@angular/core';

// TODO: один экспорт класса на файл

export abstract class ClipboardService {
  abstract writeText(text: string): Promise<void>;
}

@Injectable()
export class WebClipboardService extends ClipboardService {
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}
