import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../users/users.entity';

@Entity()
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.sentMessages)
  sender: User;

  @Column()
  senderId: string;

  @ManyToOne(() => User, (user) => user.receivedMessages)
  receiver: User;

  @Column()
  receiverId: string;

  @Column('text') // зашифрованный payload (hex)
  payload: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: false })
  delivered: boolean; // флаг доставки
}
