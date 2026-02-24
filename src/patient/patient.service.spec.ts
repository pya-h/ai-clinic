import { Test, TestingModule } from '@nestjs/testing';
import { PatientService } from './patient.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRolesEnum } from '@prisma/client';

describe('PatientService', () => {
  let service: PatientService;
  let prisma: Record<string, any>;

  const mockUser = {
    id: 'user-uuid-1',
    email: 'patient@example.com',
    firstname: 'Pat',
    lastname: 'Ient',
    role: UserRolesEnum.PATIENT,
    isAdmin: false,
    isSuperAdmin: false,
    isPrivate: false,
    isActive: true,
    avatar: null,
    password: 'hashed',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProfile = {
    id: 'profile-uuid-1',
    userId: mockUser.id,
    location: 'Tehran',
    bio: 'Test patient',
    medicalHistory: ['Flu 2024'],
    allergies: ['Penicillin'],
    medications: [],
    surgeries: [],
    familyHistory: [],
    visitMethods: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      patientProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PatientService>(PatientService);
  });

  // ─── hasProfile ───

  describe('hasProfile', () => {
    it('should return profile if exists', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);
      const result = await service.hasProfile(mockUser.id);
      expect(result).toEqual(mockProfile);
      expect(prisma.patientProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });
    });

    it('should return null if no profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      const result = await service.hasProfile(mockUser.id);
      expect(result).toBeNull();
    });
  });

  // ─── createProfile ───

  describe('createProfile', () => {
    it('should create a new patient profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      prisma.patientProfile.create.mockResolvedValue(mockProfile);

      const dto = {
        location: 'Tehran',
        bio: 'Test patient',
        medicalHistory: ['Flu 2024'],
        allergies: ['Penicillin'],
      };

      const result = await service.createProfile(mockUser as any, dto);
      expect(result).toEqual(mockProfile);
      expect(prisma.patientProfile.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          location: 'Tehran',
          bio: 'Test patient',
          medicalHistory: ['Flu 2024'],
          allergies: ['Penicillin'],
          medications: [],
          surgeries: [],
          familyHistory: [],
        },
      });
    });

    it('should throw ConflictException if profile already exists', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);

      await expect(
        service.createProfile(mockUser as any, { location: 'Tehran' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should default array fields to empty arrays', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      prisma.patientProfile.create.mockResolvedValue(mockProfile);

      await service.createProfile(mockUser as any, {});

      const createArg = prisma.patientProfile.create.mock.calls[0][0];
      expect(createArg.data.medicalHistory).toEqual([]);
      expect(createArg.data.allergies).toEqual([]);
      expect(createArg.data.medications).toEqual([]);
      expect(createArg.data.surgeries).toEqual([]);
      expect(createArg.data.familyHistory).toEqual([]);
    });
  });

  // ─── updateProfile ───

  describe('updateProfile', () => {
    it('should update existing profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);
      prisma.patientProfile.update.mockResolvedValue({
        ...mockProfile,
        bio: 'Updated bio',
      });

      const result = await service.updateProfile(mockUser as any, {
        bio: 'Updated bio',
      });
      expect(result.bio).toBe('Updated bio');
      expect(prisma.patientProfile.update).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { bio: 'Updated bio' },
      });
    });

    it('should throw NotFoundException if no profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile(mockUser as any, { bio: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getProfile ───

  describe('getProfile', () => {
    it('should return the patient profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(mockProfile);
      const result = await service.getProfile(mockUser.id);
      expect(result).toEqual(mockProfile);
    });

    it('should throw NotFoundException if no profile', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue(null);
      await expect(service.getProfile(mockUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
