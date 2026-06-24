/**
 * Session mock utilities for auth testing in E2E tests.
 * Simulates Fastify secure-session behavior.
 *
 * Uses randomized data via test-data.factory for non-constant inputs.
 */

import { UserRolesEnum } from '@prisma/client';
import {
  randomUuid,
  randomEmail,
  randomFirstName,
  randomLastName,
  randomRecentDate,
} from './test-data.factory';

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
  const now = randomRecentDate(1);
  return {
    id: randomUuid(),
    email: randomEmail('patient'),
    firstname: randomFirstName(),
    lastname: randomLastName(),
    role: UserRolesEnum.PATIENT,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    isActive: true,
    avatar: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createMockDoctorUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    email: randomEmail('doctor'),
    firstname: randomFirstName(),
    lastname: randomLastName(),
    role: UserRolesEnum.DOCTOR,
    ...overrides,
  });
}

export function createMockAdminUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    email: randomEmail('admin'),
    firstname: randomFirstName(),
    lastname: randomLastName(),
    role: UserRolesEnum.NONE,
    isAdmin: true,
    ...overrides,
  });
}

export function createMockSuperAdminUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockAdminUser({
    email: randomEmail('superadmin'),
    isSuperAdmin: true,
    ...overrides,
  });
}

export function createMockNurseUser(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    email: randomEmail('nurse'),
    firstname: randomFirstName(),
    lastname: randomLastName(),
    role: UserRolesEnum.NURSE,
    ...overrides,
  });
}
