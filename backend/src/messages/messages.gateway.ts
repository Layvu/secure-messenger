import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from './messages.service';
import { UsersService } from '../users/users.service';
import { ConnectionService } from '../core/connection.service';
import { RegisterDto } from './dto/register.dto';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      // можно читать из конфига
      callback(null, true); // для разработки
    },
  },
})
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private messagesService: MessagesService,
    private usersService: UsersService,
    private connectionService: ConnectionService,
  ) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const publicKey = this.connectionService.getPublicKey(client.id);
    this.connectionService.unregister(client.id);
    if (publicKey) {
      console.log(`User ${publicKey} disconnected`);
    }
  }

  @SubscribeMessage('register')
  async handleRegister(@ConnectedSocket() client: Socket, @MessageBody() data: RegisterDto) {
    try {
      const { publicKey } = data;
      await this.usersService.findOrCreate(publicKey);
      this.connectionService.register(client.id, publicKey);
      console.log(`User ${publicKey} registered with socket ${client.id}`);

      // Отправка не доставленных сообщений
      const undelivered = await this.messagesService.getUndeliveredMessages(publicKey);
      for (const msg of undelivered) {
        client.emit('message', {
          from: msg.sender.publicKey,
          payload: msg.payload,
          id: msg.id,
        });
      }
      if (undelivered.length > 0) {
        await this.messagesService.markAsDelivered(undelivered.map((m) => m.id));
      }
    } catch (error) {
      client.emit('error', 'Registration failed: ' + error.message);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(@ConnectedSocket() client: Socket, @MessageBody() data: SendMessageDto) {
    try {
      const { to, payload } = data;
      const fromPublicKey = this.connectionService.getPublicKey(client.id);
      if (!fromPublicKey) {
        client.emit('error', 'You must register first');
        return;
      }

      // Сохраняем сообщение в БД
      const message = await this.messagesService.saveMessage(fromPublicKey, to, payload);

      const receiverSocketId = this.connectionService.getSocketId(to);
      if (receiverSocketId) {
        // Получатель онлайн
        this.server.to(receiverSocketId).emit('message', {
          from: fromPublicKey,
          payload,
          id: message.id,
        });
        await this.messagesService.markAsDelivered([message.id]);
      } else {
        console.log(`User ${to} is offline, message stored`);
      }

      // Можно отправить подтверждение отправителю
      client.emit('messageSent', { id: message.id, to });
    } catch (error) {
      client.emit('error', 'Failed to send message: ' + error.message);
    }
  }
}
