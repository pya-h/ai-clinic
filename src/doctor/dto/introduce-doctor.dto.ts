import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DoctorSpecialtiesEnum,
  VisitMethodsEnum,
  VisitTypesEnum,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { IsEnumDetailed } from '../../common/decorators/is-enum-detailed.decorator';

export class IntroduceDoctorDto {
  @ApiProperty({ description: "The actual start date of the doctor's career" })
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  startedAt: Date;

  @ApiProperty({
    description:
      'The main specialty of the doctor; His/her main area of expertise.',
    required: true,
    enum: DoctorSpecialtiesEnum,
    enumName: 'DoctorSpecialtiesEnum',
  })
  @IsNotEmpty()
  @IsEnumDetailed(DoctorSpecialtiesEnum, 'Specialty')
  specialty: DoctorSpecialtiesEnum;

  @ApiPropertyOptional({
    description: 'Secondary specialties of the doctor, if any.',
    required: false,
    enum: DoctorSpecialtiesEnum,
    enumName: 'DoctorSpecialtiesEnum',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnumDetailed(DoctorSpecialtiesEnum, 'Specialty', true)
  secondarySpecialties?: DoctorSpecialtiesEnum[];

  @ApiProperty({
    description: 'The address of the clinic where the doctor works',
  })
  @IsOptional()
  @IsString()
  clinicLocation?: string;

  @ApiProperty({ description: 'About the doctor' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({ description: 'The university where the doctor is graduated.' })
  @IsOptional()
  @IsString()
  university?: string;

  @ApiPropertyOptional({
    description:
      'How this doctor accepts patients. This should be an array of their accepted methods.',
    required: true,
    enum: VisitMethodsEnum,
    enumName: 'VisitMethodsEnum',
    isArray: true,
  })
  @IsArray()
  @IsEnumDetailed(VisitMethodsEnum, 'Visit Method', true)
  visitMethods?: VisitMethodsEnum[];

  @ApiPropertyOptional({
    description:
      'What type of medical service(s) (or treatments) this doctor provides in his/her sessions.',
    required: true,
    enum: VisitTypesEnum,
    enumName: 'VisitTypesEnum',
    isArray: true,
  })
  @IsArray()
  @IsEnumDetailed(VisitTypesEnum, 'Visit Type', true)
  visitTypes?: VisitTypesEnum[];
}
