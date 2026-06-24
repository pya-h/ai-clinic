import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendAiMessageDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Message text is required.' })
  @MaxLength(4000)
  text: string;
}
