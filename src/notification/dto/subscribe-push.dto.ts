import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsObject()
  @IsNotEmpty()
  keys: {
    p256dh: string;
    auth: string;
  };
}
