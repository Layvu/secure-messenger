export interface RelayInfo {
  url: string;
  latency: number | null; // ms от new WebSocket() до onopen
  isActive: boolean; // входит в топ-3 по скорости
  status: 'connected' | 'connecting' | 'disconnected';
}
