export const CapsuleKind = {
  PROFILE_UPDATE: 0,
  BACKUP_POINTER: 3,
  DIRECT_MESSAGE: 4,
  READ_RECEIPT: 5,
  STORAGE_VOUCHER: 10,
  PEER_DISCOVERY: 100,
  RELAY_HEARTBEAT: 101,
} as const;

// TODO: проверить использование везде типов, констант и общих энамов
export type CapsuleKindValue = (typeof CapsuleKind)[keyof typeof CapsuleKind];

export const RELAY_SYSTEM_KINDS = new Set<number>([
  CapsuleKind.RELAY_HEARTBEAT,
  CapsuleKind.PEER_DISCOVERY,
]);

export interface SignedCapsule {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  pow_nonce: number;
  content: string;
  sig: string;
}

export interface BuildCapsuleParams {
  kind: number;
  plaintextContent: string;
  extraTags?: string[][];
  recipientPubkeyHex?: string;
}
