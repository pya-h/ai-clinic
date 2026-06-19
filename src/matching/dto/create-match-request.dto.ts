import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DoctorSpecialtiesEnum } from '@prisma/client';

export class CreateMatchRequestDto {
  @IsOptional()
  @IsUUID()
  soapId?: string;

  @IsOptional()
  @IsEnum(DoctorSpecialtiesEnum)
  specialty?: DoctorSpecialtiesEnum;
}
