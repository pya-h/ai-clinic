import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageTypeEnum } from '@prisma/client';

// SYSTEM messages come from the server, never from users.
export const USER_MESSAGE_TYPES: MessageTypeEnum[] = Object.values(
  MessageTypeEnum,
).filter((type) => type !== MessageTypeEnum.SYSTEM);

export class SendMessageDto {
  @ApiProperty({
    description: 'The text content of the message',
    example: 'Hello, doctor!',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiProperty({
    description: 'Type of message (TEXT, IMAGE, FILE, AUDIO, VIDEO)',
    enum: USER_MESSAGE_TYPES,
    default: MessageTypeEnum.TEXT,
    required: false,
  })
  @IsOptional()
  @IsIn(USER_MESSAGE_TYPES)
  type?: MessageTypeEnum;

  @ApiProperty({
    description: 'URL of attached file (for IMAGE, FILE, AUDIO, VIDEO types)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(\/uploads\/|https:\/\/)/, {
    message:
      'fileUrl must be a relative path starting with /uploads/ or an absolute HTTPS URL.',
  })
  fileUrl?: string;

  @ApiProperty({
    description: 'ID of the message being replied to',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'repliedToId must be a numeric string.' })
  repliedToId?: string;
}
