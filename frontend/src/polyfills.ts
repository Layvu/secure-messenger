import { Buffer } from 'buffer';

// чтобы библиотеки типа bip39 видели Buffer
(window as any).global = window;
(window as any).Buffer = Buffer;
(window as any).process = { env: { DEBUG: undefined }, version: '' };
