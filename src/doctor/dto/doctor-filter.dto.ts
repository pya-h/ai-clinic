import { ApiPropertyOptional } from '@nestjs/swagger';
import { DoctorSpecialtiesEnum, VisitMethodsEnum } from '@prisma/client';
import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { IsEnumDetailed } from '../../common/decorators/is-enum-detailed.decorator';

/**
 * Query parameters for filtering the public doctor listing.
 * All fields are optional — omitting everything returns all verified doctors.
 */
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
  location?: string;

  @ApiPropertyOptional({
    description: 'Search by doctor name (first or last, partial match).',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Number of records to skip (pagination offset).',
  })
  @IsOptional()
  @IsNumberString()
  skip?: number;

  @ApiPropertyOptional({
    description: 'Max number of records to return.',
  })
  @IsOptional()
  @IsNumberString()
  take?: number;
}
