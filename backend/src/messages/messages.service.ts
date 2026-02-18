import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './messages.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messagesRepository: Repository<Message>,
    private usersService: UsersService,
  ) {}

  async saveMessage(
    senderPublicKey: string,
    receiverPublicKey: string,
    payload: string,
  ): Promise<Message> {
    const sender = await this.usersService.findOrCreate(senderPublicKey);
    const receiver = await this.usersService.findOrCreate(receiverPublicKey);

    const message = this.messagesRepository.create({
      senderId: sender.id,
      receiverId: receiver.id,
      payload,
    });
    return this.messagesRepository.save(message);
  }

  async getUndeliveredMessages(publicKey: string): Promise<Message[]> {
    const user = await this.usersService.findByPublicKey(publicKey);
    if (!user) return [];

    return this.messagesRepository.find({
      where: { receiverId: user.id, delivered: false },
      relations: ['sender'],
      select: {
        id: true,
        payload: true,
        sender: { publicKey: true },
      },
    });
  }

  async markAsDelivered(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.messagesRepository.update(messageIds, { delivered: true });
  }
}
