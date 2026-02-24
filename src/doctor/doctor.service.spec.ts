/**
 * DoctorService Unit Tests
 *
 * Tests:
 *   hasProfile          — doctor has profile, no profile, check any kind
 *   createDoctorProfile — successful, wrong role, duplicate profile
 *   updateProfile       — successful, profile not found
 *   findAll             — no filters, with specialty filter, with search, pagination
 *   findOne             — found verified, not found, unverified
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileUploadService } from '../file-upload/file-upload.service';
import {
  UserRolesEnum,
  DoctorSpecialtiesEnum,
  VisitMethodsEnum,
  DocumentTypeEnum,
} from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';

describe('DoctorService', () => {
  let service: DoctorService;
  let prisma: MockPrismaService;
  let fileUploadService: Record<string, jest.Mock>;

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
    id: 1,
    userId: 'doctor-uuid',
    startedAt: new Date('2020-01-15'),
    specialty: DoctorSpecialtiesEnum.GENERAL,
    secondarySpecialties: [],
    university: null,
    location: null,
    clinicLocation: null,
    bio: null,
    visitMethods: [VisitMethodsEnum.CHAT],
    visitTypes: [],
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    rejectionReason: null,
    platformSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    fileUploadService = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn(),
      getFileUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorService,
        { provide: PrismaService, useValue: prisma },
        { provide: FileUploadService, useValue: fileUploadService },
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
      prisma.doctorProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await service.hasProfile('doctor-uuid');
      expect(result).toEqual(mockProfile);
    });

    it('should return falsy when doctor has no profile', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      const result = await service.hasProfile('doctor-uuid');
      expect(result).toBeFalsy();
    });

    it('should check patient profile when fromAnyKind is true', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      prisma.patientProfile.findUnique.mockResolvedValue({ id: 'patient-profile' });

      const result = await service.hasProfile('user-uuid', true);
      expect(result).toBeTruthy();
      expect(prisma.patientProfile.findUnique).toHaveBeenCalled();
    });

    it('should NOT check patient profile when fromAnyKind is false', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await service.hasProfile('user-uuid', false);
      expect(prisma.patientProfile.findUnique).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── createDoctorProfile ─────────────────────

  describe('createDoctorProfile', () => {
    it('should create doctor profile for doctor user', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
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
      prisma.doctorProfile.findUnique.mockResolvedValue(mockProfile);

      await expect(
        service.createDoctorProfile(mockDoctorUser as any, mockProfileData as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ───────────────────── updateProfile ─────────────────────

  describe('updateProfile', () => {
    it('should update doctor profile successfully', async () => {
      const updateData = { bio: 'Updated bio', university: 'MIT' };
      const updatedProfile = { ...mockProfile, ...updateData };

      prisma.doctorProfile.findUnique.mockResolvedValue(mockProfile);
      prisma.doctorProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.updateProfile(mockDoctorUser as any, updateData);

      expect(result).toEqual(updatedProfile);
      expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
        where: { userId: mockDoctorUser.id },
        data: updateData,
      });
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile(mockDoctorUser as any, { bio: 'new' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ───────────────────── findAll ─────────────────────

  describe('findAll', () => {
    const mockProfiles = [
      {
        ...mockProfile,
        verified: true,
        user: { id: 'doctor-uuid', firstname: 'Doc', lastname: 'Smith', avatar: null },
        _count: { reviewsAbout: 5 },
      },
    ];

    it('should return paginated verified doctors with no filters', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue(mockProfiles);
      prisma.doctorProfile.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result).toEqual({ data: mockProfiles, total: 1, skip: 0, take: 20 });
      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { verified: true },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should filter by specialty', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(0);

      await service.findAll({ specialty: DoctorSpecialtiesEnum.CARDIOLOGY });

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            verified: true,
            specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
          }),
        }),
      );
    });

    it('should filter by visitMethod', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(0);

      await service.findAll({ visitMethod: VisitMethodsEnum.CHAT });

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            visitMethods: { has: VisitMethodsEnum.CHAT },
          }),
        }),
      );
    });

    it('should apply pagination from query params', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(0);

      const result = await service.findAll({ skip: 10 as any, take: 5 as any });

      expect(result.skip).toBe(10);
      expect(result.take).toBe(5);
    });

    it('should filter by search (doctor name)', async () => {
      prisma.doctorProfile.findMany.mockResolvedValue([]);
      prisma.doctorProfile.count.mockResolvedValue(0);

      await service.findAll({ search: 'Smith' });

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              OR: [
                { firstname: { contains: 'Smith', mode: 'insensitive' } },
                { lastname: { contains: 'Smith', mode: 'insensitive' } },
              ],
            },
          }),
        }),
      );
    });
  });

  // ───────────────────── findOne ─────────────────────

  describe('findOne', () => {
    it('should return a verified doctor profile with aggregate rating', async () => {
      const profileData = {
        ...mockProfile,
        verified: true,
        user: { id: 'doctor-uuid', firstname: 'Doc', lastname: 'Smith', avatar: null },
      };
      prisma.doctorProfile.findUnique.mockResolvedValue(profileData);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: 4 },
        _count: { rating: 3 },
      });

      const result = await service.findOne(1);

      expect(result.averageRating).toBe(4);
      expect(result.totalReviews).toBe(3);
    });

    it('should return null averageRating when no reviews exist', async () => {
      const profileNoReviews = {
        ...mockProfile,
        verified: true,
        user: { id: 'doctor-uuid', firstname: 'Doc', lastname: 'Smith', avatar: null },
      };
      prisma.doctorProfile.findUnique.mockResolvedValue(profileNoReviews);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      const result = await service.findOne(1);

      expect(result.averageRating).toBeNull();
      expect(result.totalReviews).toBe(0);
    });

    it('should throw NotFoundException when profile not found', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when profile is unverified', async () => {
      const unverified = {
        ...mockProfile,
        verified: false,
        user: { id: 'doctor-uuid', firstname: 'Doc', lastname: 'Smith', avatar: null },
      };
      prisma.doctorProfile.findUnique.mockResolvedValue(unverified);
      prisma.doctorReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { rating: 0 },
      });

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  // ───────────────────── uploadDocument ─────────────────────

  describe('uploadDocument', () => {
    const mockFile = {
      filename: 'license.pdf',
      mimetype: 'application/pdf',
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('data')),
      fields: {},
    } as any;

    const mockDoc = {
      id: 1,
      doctorId: 1,
      type: DocumentTypeEnum.LICENSE,
      fileUrl: '/uploads/doctor-documents/123-license.pdf',
      fileName: 'license.pdf',
      mimeType: 'application/pdf',
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should upload a document for a doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(mockProfile);
      fileUploadService.uploadFile.mockResolvedValue({
        url: '/uploads/doctor-documents/123-license.pdf',
        fileName: 'license.pdf',
        mimeType: 'application/pdf',
        key: 'doctor-documents/123-license.pdf',
      });
      prisma.doctorDocument.create.mockResolvedValue(mockDoc);

      const result = await service.uploadDocument(
        mockDoctorUser as any,
        mockFile,
        DocumentTypeEnum.LICENSE,
      );

      expect(result).toEqual(mockDoc);
      expect(fileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFile,
        'doctor-documents',
      );
      expect(prisma.doctorDocument.create).toHaveBeenCalledWith({
        data: {
          doctorId: mockProfile.id,
          type: DocumentTypeEnum.LICENSE,
          fileUrl: '/uploads/doctor-documents/123-license.pdf',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
        },
      });
    });

    it('should throw NotFoundException if doctor has no profile', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadDocument(mockDoctorUser as any, mockFile, DocumentTypeEnum.LICENSE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ───────────────────── getDocuments ─────────────────────

  describe('getDocuments', () => {
    it('should return documents for the doctor', async () => {
      const docs = [
        { id: 1, doctorId: 1, type: DocumentTypeEnum.LICENSE, fileUrl: '/file.pdf' },
      ];
      prisma.doctorProfile.findUnique.mockResolvedValue(mockProfile);
      prisma.doctorDocument.findMany.mockResolvedValue(docs);

      const result = await service.getDocuments(mockDoctorUser as any);

      expect(result).toEqual(docs);
      expect(prisma.doctorDocument.findMany).toHaveBeenCalledWith({
        where: { doctorId: mockProfile.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw NotFoundException if doctor has no profile', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getDocuments(mockDoctorUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
