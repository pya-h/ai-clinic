/**
 * UserService Unit Tests
 *
 * Tests:
 *   getById      — found + not found
 *   getBy        — by email, by id, missing args
 *   emailExists  — exists + doesn't exist
 *   createUser   — successful + duplicate email + invalid role
 *   updateUser   — successful + empty data + email conflict + replaced avatar file deleted
 *   getUsers     — returns user list
 *   uploadAvatar — upload + update, replaced avatar file deleted (never on failure)
 *
 * Uses randomized test data via test-data.factory.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  Logger,
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
      deleteUploadedFile: jest.fn(),
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

    describe('replacing the avatar', () => {
      const uploadedAvatar = () => `/uploads/avatars/${randomUuid()}.png`;

      it.each([
        ['an external URL', () => `https://cdn.example.com/${randomUuid()}.png`],
        ['nothing (null)', () => null],
      ])('should delete the previous avatar\'s file when it is replaced by %s', async (_case, next) => {
        const previous = uploadedAvatar();
        const avatar = next();
        prisma.user.findUnique.mockResolvedValue({ avatar: previous });
        prisma.user.update.mockResolvedValue({ ...mockUser, avatar });

        const result = await service.updateUser(mockUser as any, { avatar } as any);

        expect(result.avatar).toBe(avatar);
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: mockUser.id },
          select: { avatar: true },
        });
        expect(fileUploadService.deleteUploadedFile).toHaveBeenCalledWith('avatars', previous);
        expect(fileUploadService.deleteUploadedFile.mock.invocationCallOrder[0]).toBeGreaterThan(
          prisma.user.update.mock.invocationCallOrder[0],
        );
      });

      it('should keep the file when the same avatar is sent again', async () => {
        const avatar = `https://cdn.example.com/${randomUuid()}.png`;
        prisma.user.findUnique.mockResolvedValue({ avatar });
        prisma.user.update.mockResolvedValue({ ...mockUser, avatar });

        await service.updateUser(mockUser as any, { avatar });

        expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
      });

      it('should not look up or delete the avatar when the update leaves it out', async () => {
        prisma.user.update.mockResolvedValue({ ...mockUser, firstname: randomFirstName() });

        await service.updateUser(mockUser as any, { firstname: randomFirstName() });

        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
      });

      it('should keep the previous file when the update fails', async () => {
        prisma.user.findUnique.mockResolvedValue({ avatar: uploadedAvatar() });
        prisma.user.update.mockRejectedValue(new Error('DB down'));

        await expect(
          service.updateUser(mockUser as any, { avatar: `https://cdn.example.com/${randomUuid()}.png` }),
        ).rejects.toThrow('DB down');
        expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
      });
    });
  });

  // ───────────────────── getUsers ─────────────────────

  describe('getUsers', () => {
    it('should return paginated list of non-admin users', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);
      prisma.user.count.mockResolvedValue(1);
      const result = await service.getUsers();
      expect(result.data).toEqual([mockUser]);
      expect(result.total).toBe(1);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(50);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isAdmin: false }, skip: 0, take: 50 }),
      );
    });

    it('should respect custom skip and take', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(100);
      const result = await service.getUsers(20, 10);
      expect(result.skip).toBe(20);
      expect(result.take).toBe(10);
      expect(result.total).toBe(100);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
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
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
    });

    describe('replacing a previous avatar', () => {
      let next: string;

      beforeEach(() => {
        next = `/uploads/avatars/${randomUuid()}.webp`;
        fileUploadService.uploadFile.mockResolvedValue({ url: next, key: next.slice('/uploads/'.length) });
        prisma.user.update.mockResolvedValue({ id: mockUser.id, avatar: next });
      });

      it('should delete the previous avatar read from the DB, not the session copy, after saving the new one', async () => {
        const inDb = `/uploads/avatars/${randomUuid()}.jpg`;
        const inSession = `/uploads/avatars/${randomUuid()}.png`;
        prisma.user.findUnique.mockResolvedValue({ avatar: inDb });

        const result = await service.uploadAvatar({ ...mockUser, avatar: inSession }, mockFile);

        expect(result).toEqual({ id: mockUser.id, avatar: next });
        expect(fileUploadService.deleteUploadedFile).toHaveBeenCalledTimes(1);
        expect(fileUploadService.deleteUploadedFile).toHaveBeenCalledWith('avatars', inDb);
        expect(fileUploadService.deleteUploadedFile.mock.invocationCallOrder[0]).toBeGreaterThan(
          prisma.user.update.mock.invocationCallOrder[0],
        );
      });

      it.each([
        ['no previous avatar', { avatar: null }],
        ['the user row missing', null],
      ])('should delete nothing with %s', async (_case, row) => {
        prisma.user.findUnique.mockResolvedValue(row);

        await service.uploadAvatar(mockUser, mockFile);

        expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
      });

      it('should still return the new avatar and log when deleting the old file fails', async () => {
        const previous = `/uploads/avatars/${randomUuid()}.png`;
        prisma.user.findUnique.mockResolvedValue({ avatar: previous });
        fileUploadService.deleteUploadedFile.mockRejectedValue(new Error('EACCES'));
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

        await expect(service.uploadAvatar(mockUser, mockFile)).resolves.toEqual({
          id: mockUser.id,
          avatar: next,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(previous));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
        warn.mockRestore();
      });

      it('should keep the previous file when saving the new avatar fails', async () => {
        prisma.user.findUnique.mockResolvedValue({ avatar: `/uploads/avatars/${randomUuid()}.png` });
        prisma.user.update.mockRejectedValue(new Error('DB down'));

        await expect(service.uploadAvatar(mockUser, mockFile)).rejects.toThrow('DB down');
        expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
      });
    });
  });
});
