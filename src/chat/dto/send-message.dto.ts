import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageTypeEnum } from '@prisma/client';

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
    description: 'Type of message (TEXT, IMAGE, FILE, AUDIO, VIDEO, SYSTEM)',
    enum: MessageTypeEnum,
    default: MessageTypeEnum.TEXT,
    required: false,
  })
  @IsOptional()
  @IsEnum(MessageTypeEnum)
  type?: MessageTypeEnum;

  @ApiProperty({
    description: 'URL of attached file (for IMAGE, FILE, AUDIO, VIDEO types)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(\/uploads\/|https:\/\/)/, {
    message: 'fileUrl must be a relative path starting with /uploads/ or an absolute HTTPS URL.',
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
