import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './users.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findOrCreate(publicKey: string): Promise<User> {
    let user = await this.usersRepository.findOne({ where: { publicKey } });
    if (!user) {
      user = this.usersRepository.create({ publicKey });
      user = await this.usersRepository.save(user);
    }
    return user;
  }

  async findByPublicKey(publicKey: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { publicKey } });
  }
}
