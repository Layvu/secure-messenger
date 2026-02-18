import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';
import { Message } from './messages.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Message]), UsersModule],
  providers: [MessagesGateway, MessagesService],
})
export class MessagesModule {}
