import { ApiPropertyOptional } from '@nestjs/swagger';
import { DoctorSpecialtiesEnum, VisitMethodsEnum } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsEnumDetailed } from '../../common/decorators/is-enum-detailed.decorator';

export class DoctorFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by primary specialty.',
    enum: DoctorSpecialtiesEnum,
    enumName: 'DoctorSpecialtiesEnum',
  })
  @IsOptional()
  @IsEnumDetailed(DoctorSpecialtiesEnum, 'Specialty')
  specialty?: DoctorSpecialtiesEnum;

  @ApiPropertyOptional({
    description: 'Filter by accepted visit method.',
    enum: VisitMethodsEnum,
    enumName: 'VisitMethodsEnum',
  })
  @IsOptional()
  @IsEnumDetailed(VisitMethodsEnum, 'Visit Method')
  visitMethod?: VisitMethodsEnum;

  @ApiPropertyOptional({
    description: 'Filter by location (partial match, case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({
    description: 'Search by doctor name (first or last, partial match).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Number of records to skip (pagination offset).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({
    description: 'Max number of records to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
