import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OpenAiChatDto {
  @IsString()
  @IsNotEmpty({ message: 'Message is required.' })
  @MaxLength(4000)
  message: string;
}
