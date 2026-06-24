import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NursePermissionEnum } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignNurseDto {
  @ApiProperty({ description: 'User ID of the nurse to assign.' })
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
