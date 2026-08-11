import { ApiProperty } from '@nestjs/swagger';
import { NursePermissionEnum } from '@prisma/client';
import { IsArray, IsEnum } from 'class-validator';

export class UpdatePermissionsDto {
  @ApiProperty({
    description:
      'Updated permissions for the nurse. An empty array revokes all permissions.',
    enum: NursePermissionEnum,
    isArray: true,
    example: ['VIEW_PATIENTS', 'VIEW_SOAPS', 'MANAGE_APPOINTMENTS'],
  })
  @IsArray()
  @IsEnum(NursePermissionEnum, { each: true })
  permissions: NursePermissionEnum[];
}
