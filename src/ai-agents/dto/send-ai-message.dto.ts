import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendAiMessageDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Message text is required.' })
  text: string;
}
