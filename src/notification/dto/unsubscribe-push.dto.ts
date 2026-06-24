import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint: string;
}
