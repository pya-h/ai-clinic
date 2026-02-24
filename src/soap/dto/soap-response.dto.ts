import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DoctorSpecialtiesEnum, TriageLevelEnum } from '@prisma/client';

export class SoapResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  conversationId: string;

  @ApiPropertyOptional()
  subjective?: string;

  @ApiPropertyOptional()
  objective?: string;

  @ApiPropertyOptional()
  assessment?: string;

  @ApiPropertyOptional()
  plan?: string;

  @ApiProperty()
  rawNote: string;

  @ApiPropertyOptional({ enum: DoctorSpecialtiesEnum })
  suggestedSpecialty?: DoctorSpecialtiesEnum;

  @ApiPropertyOptional({ enum: TriageLevelEnum })
  triageLevel?: TriageLevelEnum;

  @ApiPropertyOptional()
  confidenceScores?: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
