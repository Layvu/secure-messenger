export abstract class LocalStorageService {
  abstract get(key: string): string | null;
  abstract set(key: string, value: string): void;
  abstract remove(key: string): void;
  abstract has(key: string): boolean;
}

// TODO: один файл - один экспорт класса

import { Injectable } from '@angular/core';

@Injectable()
export class WebLocalStorageService extends LocalStorageService {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }

  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }

  has(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }
}
