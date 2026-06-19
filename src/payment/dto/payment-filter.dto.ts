import { IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatusEnum } from '@prisma/client';

export class PaymentFilterDto {
  @ApiPropertyOptional({ enum: PaymentStatusEnum })
  @IsEnum(PaymentStatusEnum)
  @IsOptional()
  status?: PaymentStatusEnum;

  @ApiPropertyOptional({ default: 0 })
  @Type(() => Number)
  @IsOptional()
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsOptional()
  take?: number;
}
