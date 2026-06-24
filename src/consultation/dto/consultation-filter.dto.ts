import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationStatusEnum } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({
    description: 'Max number of items to be fetched.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
