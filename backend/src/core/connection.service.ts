import { Injectable } from '@nestjs/common';

@Injectable()
export class ConnectionService {
  // publicKey -> socketId
  private userToSocket = new Map<string, string>();
  // socketId -> publicKey
  private socketToUser = new Map<string, string>();

  register(socketId: string, publicKey: string): void {
    this.userToSocket.set(publicKey, socketId);
    this.socketToUser.set(socketId, publicKey);
  }

  unregister(socketId: string): void {
    const publicKey = this.socketToUser.get(socketId);
    if (publicKey) {
      this.userToSocket.delete(publicKey);
      this.socketToUser.delete(socketId);
    }
  }

  getSocketId(publicKey: string): string | undefined {
    return this.userToSocket.get(publicKey);
  }

  getPublicKey(socketId: string): string | undefined {
    return this.socketToUser.get(socketId);
  }

  isOnline(publicKey: string): boolean {
    return this.userToSocket.has(publicKey);
  }

  getAllOnlineUsers(): string[] {
    return Array.from(this.userToSocket.keys());
  }
}
