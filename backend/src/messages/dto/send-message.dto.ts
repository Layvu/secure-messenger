import { IsString, Matches } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: 'to must be a 64-character hex string' })
  to: string;

  @IsString()
  payload: string;
}
