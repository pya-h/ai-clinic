import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationModeEnum, VisitMethodsEnum } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class DoctorDecisionDto {
  @ApiProperty({
    description: 'The consultation mode decided by the doctor.',
    enum: ConsultationModeEnum,
  })
  @IsNotEmpty()
  @IsEnum(ConsultationModeEnum)
  doctorDecision: ConsultationModeEnum;

  @ApiPropertyOptional({
    description: 'The visit method for the consultation.',
    enum: VisitMethodsEnum,
  })
  @IsOptional()
  @IsEnum(VisitMethodsEnum)
  visitMethod?: VisitMethodsEnum;
}
