export const CapsuleKind = {
  PROFILE_UPDATE: 0,
  BACKUP_POINTER: 3,
  DIRECT_MESSAGE: 4,
  READ_RECEIPT: 5,
  STORAGE_VOUCHER: 10,
  PEER_DISCOVERY: 100,
  RELAY_HEARTBEAT: 101,
} as const;

export type CapsuleKindValue = (typeof CapsuleKind)[keyof typeof CapsuleKind];

// TODO: проверить использование везде типов, констант и общих энамов
export const RELAY_SYSTEM_KINDS = new Set<CapsuleKindValue>([
  CapsuleKind.RELAY_HEARTBEAT,
  CapsuleKind.PEER_DISCOVERY,
]);

export interface SignedCapsule {
  id: string;
  pubkey: string;
  created_at: number;
  kind: CapsuleKindValue;
  tags: string[][];
  pow_nonce: number;
  content: string;
  sig: string;
}

export interface BuildCapsuleParams {
  kind: CapsuleKindValue;
  plaintextContent: string;
  extraTags?: string[][];
  recipientPubkeyHex?: string;
}
