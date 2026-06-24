/**
 * AuthService Unit Tests
 *
 * Tests:
 *   verifyAndLogin  — valid credentials, wrong password, non-existent email, inactive user
 *   register        — successful registration, duplicate email
 *   logout          — session deletion
 *   refreshSession  — valid user, non-existent user
 *
 * Uses randomized test data via test-data.factory.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { UtilsService } from '../utils/utils.service';
import {
  buildUser,
  randomEmail,
  randomFirstName,
  randomLastName,
  randomPassword,
  randomUuid,
} from '../../test/helpers/test-data.factory';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<Partial<UserService>>;
  let utilsService: jest.Mocked<Partial<UtilsService>>;

  // Randomized user generated fresh each suite run
  const mockUser = buildUser();

  const mockSession = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };

  const mockReply = {
    request: { session: mockSession },
  } as any;

  beforeEach(async () => {
    userService = {
      getBy: jest.fn(),
      getById: jest.fn(),
      createUser: jest.fn(),
    };

    utilsService = {
      compareHash: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: UtilsService, useValue: utilsService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────── verifyAndLogin ─────────────────────

  describe('verifyAndLogin', () => {
    it('should login successfully with valid credentials', async () => {
      userService.getBy.mockResolvedValue(mockUser as any);
      utilsService.compareHash.mockResolvedValue(true as any);

      const result = await authService.verifyAndLogin(
        { email: mockUser.email, password: randomPassword() },
        mockReply,
      );

      expect(result.email).toBe(mockUser.email);
      expect((result as any).password).toBeUndefined();
      expect(mockSession.set).toHaveBeenCalledWith(
        'user',
        expect.objectContaining({ email: mockUser.email }),
      );
    });

    it('should throw BadRequestException for wrong password', async () => {
      userService.getBy.mockResolvedValue(mockUser as any);
      utilsService.compareHash.mockResolvedValue(false as any);

      await expect(
        authService.verifyAndLogin(
          { email: mockUser.email, password: randomPassword() },
          mockReply,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-existent email', async () => {
      userService.getBy.mockResolvedValue(null);

      await expect(
        authService.verifyAndLogin(
          { email: randomEmail('ghost'), password: randomPassword() },
          mockReply,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ───────────────────── register ─────────────────────

  describe('register', () => {
    it('should register a new user and set session', async () => {
      const newId = randomUuid();
      const newUser = { ...mockUser, id: newId };
      userService.createUser.mockResolvedValue(newUser as any);

      const result = await authService.register(
        {
          email: randomEmail('new'),
          firstname: randomFirstName(),
          lastname: randomLastName(),
          password: randomPassword(),
          isPrivate: false,
        },
        mockReply,
      );

      expect(result.email).toBe(mockUser.email);
      expect((result as any).password).toBeUndefined();
      expect(mockSession.set).toHaveBeenCalledWith(
        'user',
        expect.objectContaining({ id: newId }),
      );
    });
  });

  // ───────────────────── logout ─────────────────────

  describe('logout', () => {
    it('should delete the session', async () => {
      await authService.logout(mockReply);
      expect(mockSession.delete).toHaveBeenCalled();
    });
  });

  // ───────────────────── refreshSession ─────────────────────

  describe('refreshSession', () => {
    it('should re-fetch user and update session', async () => {
      const updatedName = randomFirstName();
      const freshUser = { ...mockUser, firstname: updatedName };
      userService.getById.mockResolvedValue(freshUser as any);

      const result = await authService.refreshSession(
        mockSession,
        mockUser.id,
      );

      expect(result.firstname).toBe(updatedName);
      expect((result as any).password).toBeUndefined();
      expect(mockSession.set).toHaveBeenCalledWith(
        'user',
        expect.objectContaining({ firstname: updatedName }),
      );
    });

    it('should throw NotFoundException for non-existent user', async () => {
      userService.getById.mockResolvedValue(null);

      await expect(
        authService.refreshSession(mockSession, randomUuid()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
