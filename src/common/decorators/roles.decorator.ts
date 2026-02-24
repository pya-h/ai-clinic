import { SetMetadata } from '@nestjs/common';
import { UserRolesEnum } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRolesEnum[]) =>
  SetMetadata(ROLES_KEY, roles);
