import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameConversationDto {
  @IsString()
  @IsNotEmpty({ message: 'Topic is required.' })
  @MaxLength(120, { message: 'Topic must be at most 120 characters.' })
  topic: string;
}
