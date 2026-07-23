/**
 * UserService Unit Tests
 *
 * Tests:
 *   getById      — found + not found
 *   getBy        — by email, by id, missing args
 *   emailExists  — exists + doesn't exist
 *   createUser   — successful + duplicate email + invalid role
 *   updateUser   — successful + empty data + email conflict
 *   getUsers     — returns user list
 *
 * Uses randomized test data via test-data.factory.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UtilsService } from '../utils/utils.service';
import { FileUploadService } from '../file-upload/file-upload.service';
import { UserRolesEnum } from '@prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/helpers/mock-prisma.helper';
import {
  buildUser,
  randomEmail,
  randomFirstName,
  randomLastName,
  randomUuid,
} from '../../test/helpers/test-data.factory';

describe('UserService', () => {
  let service: UserService;
  let prisma: MockPrismaService;
  let utilsService: Record<string, jest.Mock>;
  let fileUploadService: Record<string, jest.Mock>;

  const mockUser = buildUser();

  beforeEach(async () => {
    prisma = createMockPrismaService();
    utilsService = {
      getHash: jest.fn().mockResolvedValue('hashedpassword'),
      isEnumElement: jest.fn().mockReturnValue(true),
    };
    fileUploadService = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn(),
      getFileUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: UtilsService, useValue: utilsService },
        { provide: FileUploadService, useValue: fileUploadService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────── getById ─────────────────────

  describe('getById', () => {
    it('should return user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.getById('user-uuid');
      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-uuid' } }),
      );
    });

    it('should return null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ───────────────────── getBy ─────────────────────

  describe('getBy', () => {
    it('should find user by email', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      const result = await service.getBy({ email: 'test@example.com' });
      expect(result).toEqual(mockUser);
    });

    it('should find user by id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.getBy({ id: 'user-uuid' });
      expect(result).toEqual(mockUser);
    });

    it('should throw BadRequestException if no identifier provided', () => {
      expect(() => service.getBy({})).toThrow(BadRequestException);
    });
  });

  // ───────────────────── emailExists ─────────────────────

  describe('emailExists', () => {
    it('should return true when email exists', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      const result = await service.emailExists('test@example.com');
      expect(result).toBe(true);
    });

    it('should return false when email does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const result = await service.emailExists('nobody@example.com');
      expect(result).toBe(false);
    });
  });

  // ───────────────────── createUser ─────────────────────

  describe('createUser', () => {
    const registerDto = {
      email: randomEmail('register'),
      firstname: randomFirstName(),
      lastname: randomLastName(),
      password: 'Str0ngP@ss1',
      role: UserRolesEnum.PATIENT as any,
      isPrivate: false,
    };

    it('should create a user successfully', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // no existing email
      prisma.user.create.mockResolvedValue({ ...mockUser, ...registerDto });

      const result = await service.createUser(registerDto);
      expect(result).toBeDefined();
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: registerDto.email,
            password: 'hashedpassword',
          }),
        }),
      );
    });

    it('should throw ConflictException for duplicate email', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser); // email exists

      await expect(service.createUser(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException for invalid role', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      utilsService.isEnumElement.mockReturnValue(false);

      await expect(
        service.createUser({ ...registerDto, role: 'INVALID' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ───────────────────── updateUser ─────────────────────

  describe('updateUser', () => {
    it('should update user with valid data', async () => {
      const updatedName = randomFirstName();
      prisma.user.findFirst.mockResolvedValue(null); // no email conflict
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        firstname: updatedName,
      });

      const result = await service.updateUser(mockUser as any, {
        firstname: updatedName,
      });
      expect(result.firstname).toBe(updatedName);
    });

    it('should throw BadRequestException for empty update data', async () => {
      await expect(
        service.updateUser(mockUser as any, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException for duplicate email', async () => {
      const takenEmail = randomEmail('taken');
      prisma.user.findFirst.mockResolvedValue({
        id: randomUuid(),
        email: takenEmail,
      });

      await expect(
        service.updateUser(mockUser as any, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ───────────────────── getUsers ─────────────────────

  describe('getUsers', () => {
    it('should return list of non-admin users', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);
      const result = await service.getUsers();
      expect(Array.isArray(result)).toBe(true);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isAdmin: false } }),
      );
    });
  });

  describe('uploadAvatar', () => {
    const mockFile = {
      filename: 'avatar.png',
      mimetype: 'image/png',
      file: { bytesRead: 1024 },
      toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(1024)),
    } as any;

    it('should upload avatar and update user record', async () => {
      fileUploadService.uploadFile.mockResolvedValue({
        url: '/uploads/avatars/12345-avatar.png',
        key: 'avatars/12345-avatar.png',
      });
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        avatar: '/uploads/avatars/12345-avatar.png',
      });

      const result = await service.uploadAvatar(mockUser, mockFile);

      expect(fileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFile,
        'avatars',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { avatar: '/uploads/avatars/12345-avatar.png' },
        select: { id: true, avatar: true },
      });
      expect(result.avatar).toBe('/uploads/avatars/12345-avatar.png');
    });

    it('should propagate upload errors', async () => {
      fileUploadService.uploadFile.mockRejectedValue(
        new Error('Invalid file type'),
      );

      await expect(service.uploadAvatar(mockUser, mockFile)).rejects.toThrow(
        'Invalid file type',
      );
    });
  });
});
