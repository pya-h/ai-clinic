import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChatDto {
  @ApiProperty({
    description: 'ID of the user to start a chat with',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  participantId: string;

  @ApiProperty({
    description: 'Optional topic / subject for this chat',
    required: false,
  })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiProperty({
    description: 'Optional consultation ID to link this chat to',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  consultationId?: string;
}
