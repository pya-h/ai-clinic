/**
 * Session mock utilities for auth testing in E2E tests.
 * Simulates Fastify secure-session behavior.
 */

import { UserRolesEnum } from '@prisma/client';

export interface MockUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: UserRolesEnum;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isPrivate: boolean;
  isActive: boolean;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'test-user-uuid-1234',
    email: 'testuser@example.com',
    firstname: 'Test',
    lastname: 'User',
    role: UserRolesEnum.PATIENT,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    isActive: true,
    avatar: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createMockDoctorUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    id: 'test-doctor-uuid-5678',
    email: 'doctor@example.com',
    firstname: 'Doc',
    lastname: 'Smith',
    role: UserRolesEnum.DOCTOR,
    ...overrides,
  });
}

export function createMockAdminUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    id: 'test-admin-uuid-9999',
    email: 'admin@example.com',
    firstname: 'Admin',
    lastname: 'Boss',
    role: UserRolesEnum.NONE,
    isAdmin: true,
    ...overrides,
  });
}

export function createMockSuperAdminUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockAdminUser({
    id: 'test-superadmin-uuid-0000',
    email: 'superadmin@example.com',
    isSuperAdmin: true,
    ...overrides,
  });
}
