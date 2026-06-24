import { ApiProperty } from '@nestjs/swagger';
import { NursePermissionEnum } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';

export class UpdatePermissionsDto {
  @ApiProperty({
    description: 'Updated permissions for the nurse.',
    enum: NursePermissionEnum,
    isArray: true,
    example: ['VIEW_PATIENTS', 'VIEW_SOAPS', 'MANAGE_APPOINTMENTS'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(NursePermissionEnum, { each: true })
  permissions: NursePermissionEnum[];
}
