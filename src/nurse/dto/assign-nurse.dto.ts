import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NursePermissionEnum } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AssignNurseDto {
  @ApiProperty({ description: 'User ID to assign as nurse. PATIENT/NONE users are auto-upgraded to NURSE role.' })
  @IsUUID()
  nurseId: string;

  @ApiPropertyOptional({
    description: 'Permissions granted to the nurse.',
    enum: NursePermissionEnum,
    isArray: true,
    example: ['VIEW_PATIENTS', 'VIEW_SOAPS'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(NursePermissionEnum, { each: true })
  permissions?: NursePermissionEnum[];
}
