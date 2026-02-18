import { IsString, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: 'publicKey must be a 64-character hex string' })
  publicKey: string;
}
