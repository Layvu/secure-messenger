import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CoreModule } from './core/core.module';
import { UsersModule } from './users/users.module';
import { MessagesModule } from './messages/messages.module';
import { User } from './users/users.entity';
import { Message } from './messages/messages.entity';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_DATABASE'),
        entities: [User, Message],
        synchronize: true, // только для разработки
      }),
    }),
    CoreModule,
    UsersModule,
    MessagesModule,
  ],
})
export class AppModule {}
