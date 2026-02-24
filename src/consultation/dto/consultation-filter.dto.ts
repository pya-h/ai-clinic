import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationStatusEnum } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional } from 'class-validator';

export class ConsultationFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by consultation status.',
    enum: ConsultationStatusEnum,
  })
  @IsOptional()
  @IsEnum(ConsultationStatusEnum)
  status?: ConsultationStatusEnum;

  @ApiPropertyOptional({
    description: 'The index of item to start fetching items from.',
  })
  @IsOptional()
  @IsNumberString()
  skip?: number;

  @ApiPropertyOptional({
    description: 'Max number of items to be fetched.',
  })
  @IsOptional()
  @IsNumberString()
  take?: number;
}
