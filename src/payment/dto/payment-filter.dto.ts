import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatusEnum } from '@prisma/client';

export class PaymentFilterDto {
  @ApiPropertyOptional({ enum: PaymentStatusEnum })
  @IsEnum(PaymentStatusEnum)
  @IsOptional()
  status?: PaymentStatusEnum;

  @ApiPropertyOptional({ description: 'Filter by user ID (admin only).' })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
