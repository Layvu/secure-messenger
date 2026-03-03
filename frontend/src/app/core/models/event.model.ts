export interface SignedEvent {
  id: string; // BLAKE2b хеш (hex) от сериализованных данных
  pubkey: string; // Ed25519 публичный ключ отправителя (hex)
  created_at: number; // Unix timestamp (время создания)
  kind: number; // Тип: 4 - Зашифрованное сообщение, 0 - Метаданные (в будущем)
  tags: string[][]; // Метаданные, например [["p", "ID_ПОЛУЧАТЕЛЯ"]]
  pow_nonce: number; // Плата за отправку (Proof-of-Work). Пока ставим 0
  content: string; // Зашифрованный payload (ciphertext + nonce)
  sig: string; // Ed25519 криптографическая подпись поля 'id' (hex)
}
