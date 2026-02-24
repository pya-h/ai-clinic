/**
 * DoctorService Unit Tests
 *
 * Tests:
 *   hasProfile          — doctor has profile, no profile, check any kind
 *   createDoctorProfile — successful, wrong role, duplicate profile
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  MethodNotAllowedException,
} from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserRolesEnum, DoctorSpecialtiesEnum } from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';

describe('DoctorService', () => {
  let service: DoctorService;
  let prisma: MockPrismaService;

  const mockDoctorUser = {
    id: 'doctor-uuid',
    email: 'doctor@example.com',
    firstname: 'Doc',
    lastname: 'Smith',
    role: UserRolesEnum.DOCTOR,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    isActive: true,
    avatar: null,
    password: 'hashed',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPatientUser = {
    ...mockDoctorUser,
    id: 'patient-uuid',
    role: UserRolesEnum.PATIENT,
  };

  const mockProfileData = {
    startedAt: new Date('2020-01-15'),
    specialty: DoctorSpecialtiesEnum.GENERAL,
    visitMethods: ['ONLINE'],
    visitTypes: ['FIRST_VISIT'],
  };

  const mockProfile = {
    id: 'profile-uuid',
    userId: 'doctor-uuid',
    startedAt: new Date('2020-01-15'),
    specialty: DoctorSpecialtiesEnum.GENERAL,
    verified: false,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DoctorService>(DoctorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────── hasProfile ─────────────────────

  describe('hasProfile', () => {
    it('should return profile when doctor has one', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(mockProfile);

      const result = await service.hasProfile('doctor-uuid');
      expect(result).toEqual(mockProfile);
    });

    it('should return falsy when doctor has no profile', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(null);

      const result = await service.hasProfile('doctor-uuid');
      expect(result).toBeFalsy();
    });

    it('should check patient profile when fromAnyKind is true', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(null);
      prisma.patientProfile.findFirst.mockResolvedValue({ id: 'patient-profile' });

      const result = await service.hasProfile('user-uuid', true);
      expect(result).toBeTruthy();
      expect(prisma.patientProfile.findFirst).toHaveBeenCalled();
    });

    it('should NOT check patient profile when fromAnyKind is false', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(null);

      await service.hasProfile('user-uuid', false);
      expect(prisma.patientProfile.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── createDoctorProfile ─────────────────────

  describe('createDoctorProfile', () => {
    it('should create doctor profile for doctor user', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(null);
      prisma.doctorProfile.create.mockResolvedValue(mockProfile);

      const result = await service.createDoctorProfile(
        mockDoctorUser as any,
        mockProfileData as any,
      );

      expect(result).toEqual(mockProfile);
      expect(prisma.doctorProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: mockDoctorUser.id }),
        }),
      );
    });

    it('should throw MethodNotAllowedException for non-doctor user', async () => {
      await expect(
        service.createDoctorProfile(mockPatientUser as any, mockProfileData as any),
      ).rejects.toThrow(MethodNotAllowedException);
    });

    it('should throw ConflictException if doctor already has profile', async () => {
      prisma.doctorProfile.findFirst.mockResolvedValue(mockProfile);

      await expect(
        service.createDoctorProfile(mockDoctorUser as any, mockProfileData as any),
      ).rejects.toThrow(ConflictException);
    });
  });
});
