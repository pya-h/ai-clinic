/**
 * Test Data Factory — generates randomized but valid test data.
 *
 * All values follow system rules (valid emails, strong passwords,
 * realistic names, recent dates, etc.) while being non-constant
 * across test runs.
 */
import { randomUUID } from 'crypto';
import { UserRolesEnum, DoctorSpecialtiesEnum } from '@prisma/client';

// ── Primitives ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aria', 'Darius', 'Shirin', 'Kian', 'Nilou', 'Parsa',
  'Sara', 'Reza', 'Leila', 'Amir', 'Yara', 'Babak',
  'Mina', 'Omid', 'Neda', 'Farhad', 'Tara', 'Kaveh',
];

const LAST_NAMES = [
  'Tehrani', 'Shirazi', 'Esfahani', 'Tabatabaei', 'Hosseini',
  'Mousavi', 'Rezaei', 'Ahmadi', 'Moradi', 'Karimi',
  'Ghorbani', 'Jafari', 'Rostami', 'Bahrami', 'Sadeghi',
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min)) + min;
const slug = () => Math.random().toString(36).slice(2, 8);

// ── Generators ────────────────────────────────────────────────────────

export function randomUuid(): string {
  return randomUUID();
}

export function randomEmail(prefix?: string): string {
  const p = prefix ?? `user_${slug()}`;
  return `${p}@test-${slug()}.com`;
}

export function randomFirstName(): string {
  return pick(FIRST_NAMES);
}

export function randomLastName(): string {
  return pick(LAST_NAMES);
}

/**
 * Returns a strong password that satisfies typical validators:
 * ≥8 chars, uppercase, lowercase, digit.
 */
export function randomPassword(): string {
  const base = `Str0ng${slug()}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Returns a recent date within the last N years (default 3).
 */
export function randomRecentDate(withinYears = 3): Date {
  const now = Date.now();
  const msBack = withinYears * 365.25 * 24 * 60 * 60 * 1000;
  return new Date(now - Math.random() * msBack);
}

/**
 * Returns a career start date (2–20 years ago).
 */
export function randomCareerStartDate(): Date {
  const yearsAgo = randInt(2, 20);
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  d.setMonth(randInt(0, 12));
  d.setDate(randInt(1, 28));
  return d;
}

export function randomSpecialty(): DoctorSpecialtiesEnum {
  const values = Object.values(DoctorSpecialtiesEnum);
  return pick(values);
}

export function randomRole(): UserRolesEnum {
  const roles = [
    UserRolesEnum.PATIENT,
    UserRolesEnum.DOCTOR,
    UserRolesEnum.NURSE,
  ];
  return pick(roles);
}

export function randomBio(): string {
  const bios = [
    'Experienced healthcare professional dedicated to patient care.',
    'Passionate about preventive medicine and wellness.',
    'Board-certified specialist with research background.',
    'Committed to evidence-based clinical practice.',
  ];
  return pick(bios);
}

export function randomLocation(): string {
  const cities = ['Tehran', 'Shiraz', 'Isfahan', 'Tabriz', 'Mashhad', 'Ahvaz'];
  return pick(cities);
}

// ── Composite Factories ────────────────────────────────────────────────

export interface TestUser {
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
  password: string;
  botpressUserKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function buildUser(overrides: Partial<TestUser> = {}): TestUser {
  const now = randomRecentDate(1);
  return {
    id: randomUuid(),
    email: randomEmail(),
    firstname: randomFirstName(),
    lastname: randomLastName(),
    role: UserRolesEnum.PATIENT,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    isActive: true,
    avatar: null,
    password: 'hashed_' + slug(),
    botpressUserKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function buildDoctorUser(overrides: Partial<TestUser> = {}): TestUser {
  return buildUser({
    role: UserRolesEnum.DOCTOR,
    ...overrides,
  });
}

export function buildAdminUser(overrides: Partial<TestUser> = {}): TestUser {
  return buildUser({
    role: UserRolesEnum.NONE,
    isAdmin: true,
    ...overrides,
  });
}

export function buildSuperAdminUser(overrides: Partial<TestUser> = {}): TestUser {
  return buildUser({
    role: UserRolesEnum.NONE,
    isAdmin: true,
    isSuperAdmin: true,
    ...overrides,
  });
}

export function buildNurseUser(overrides: Partial<TestUser> = {}): TestUser {
  return buildUser({
    role: UserRolesEnum.NURSE,
    ...overrides,
  });
}

export interface TestDoctorProfile {
  id: number;
  userId: string;
  startedAt: Date;
  specialty: DoctorSpecialtiesEnum;
  secondarySpecialties: DoctorSpecialtiesEnum[];
  university: string | null;
  location: string | null;
  clinicLocation: string | null;
  bio: string | null;
  visitMethods: string[];
  visitTypes: string[];
  verified: boolean;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  platformSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function buildDoctorProfile(
  overrides: Partial<TestDoctorProfile> = {},
): TestDoctorProfile {
  const now = randomRecentDate(1);
  return {
    id: randInt(1, 9999),
    userId: randomUuid(),
    startedAt: randomCareerStartDate(),
    specialty: randomSpecialty(),
    secondarySpecialties: [],
    university: null,
    location: randomLocation(),
    clinicLocation: null,
    bio: randomBio(),
    visitMethods: ['CHAT'],
    visitTypes: [],
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    rejectionReason: null,
    platformSummary: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface TestPatientProfile {
  id: string;
  userId: string;
  location: string;
  bio: string;
  medicalHistory: string[];
  allergies: string[];
  medications: string[];
  surgeries: string[];
  familyHistory: string[];
  visitMethods: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function buildPatientProfile(
  overrides: Partial<TestPatientProfile> = {},
): TestPatientProfile {
  const now = randomRecentDate(1);
  return {
    id: randomUuid(),
    userId: randomUuid(),
    location: randomLocation(),
    bio: randomBio(),
    medicalHistory: [],
    allergies: [],
    medications: [],
    surgeries: [],
    familyHistory: [],
    visitMethods: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface TestChat {
  id: string;
  topic: string | null;
  consultationId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  parties: Array<{ userId: string; joinedAt: Date; lastSeenAt: Date | null }>;
}

export function buildChat(overrides: Partial<TestChat> = {}): TestChat {
  const now = new Date();
  return {
    id: randomUuid(),
    topic: null,
    consultationId: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    parties: [],
    ...overrides,
  };
}

export interface TestMessage {
  id: bigint;
  chatId: string;
  senderId: string;
  content: string;
  type: string;
  fileUrl: string | null;
  repliedToId: bigint | null;
  readBy: any;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function buildMessage(overrides: Partial<TestMessage> = {}): TestMessage {
  const now = new Date();
  return {
    id: BigInt(randInt(1, 999999)),
    chatId: randomUuid(),
    senderId: randomUuid(),
    content: `Test message ${slug()}`,
    type: 'TEXT',
    fileUrl: null,
    repliedToId: null,
    readBy: null,
    editedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
