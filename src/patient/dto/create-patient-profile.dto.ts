import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePatientProfileDto {
  @ApiPropertyOptional({ description: 'Patient location / city' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Short bio about the patient' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    description: 'List of past medical conditions',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicalHistory?: string[];

  @ApiPropertyOptional({
    description: 'Known allergies',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({
    description: 'Current medications',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medications?: string[];

  @ApiPropertyOptional({
    description: 'Past surgeries',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  surgeries?: string[];

  @ApiPropertyOptional({
    description: 'Relevant family medical history',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  familyHistory?: string[];
}
