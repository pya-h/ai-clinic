/**
 * UtilsService Unit Tests
 *
 * Tests:
 *   getHash / compareHash — bcrypt hashing
 *   isEnumElement         — enum membership check
 *   toCapitalCase         — string transformation
 *   truncateString        — string truncation
 *   approximate           — number approximation
 *   generateRandomNumberInRange — random number generation
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UtilsService } from './utils.service';
import { UserRolesEnum } from '@prisma/client';

describe('UtilsService', () => {
  let service: UtilsService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(4), // low salt rounds for fast tests
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UtilsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UtilsService>(UtilsService);
  });

  // ───────────────────── getHash / compareHash ─────────────────────

  describe('getHash + compareHash', () => {
    it('should hash a string and verify it matches', async () => {
      const plaintext = 'MySecretPassword1';
      const hashed = await service.getHash(plaintext);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(plaintext);

      const isMatch = await service.compareHash(plaintext, hashed);
      expect(isMatch).toBe(true);
    });

    it('should return false for mismatched password', async () => {
      const hashed = await service.getHash('CorrectPassword1');
      const isMatch = await service.compareHash('WrongPassword1', hashed);
      expect(isMatch).toBe(false);
    });
  });

  // ───────────────────── isEnumElement ─────────────────────

  describe('isEnumElement', () => {
    it('should return true for valid enum value', () => {
      expect(service.isEnumElement(UserRolesEnum, 'PATIENT')).toBe(true);
      expect(service.isEnumElement(UserRolesEnum, 'DOCTOR')).toBe(true);
      expect(service.isEnumElement(UserRolesEnum, 'NURSE')).toBe(true);
      expect(service.isEnumElement(UserRolesEnum, 'NONE')).toBe(true);
    });

    it('should return false for invalid enum value', () => {
      expect(service.isEnumElement(UserRolesEnum, 'SUPERADMIN')).toBe(false);
      expect(service.isEnumElement(UserRolesEnum, 'INVALID')).toBe(false);
      expect(service.isEnumElement(UserRolesEnum, '')).toBe(false);
      expect(service.isEnumElement(UserRolesEnum, null)).toBe(false);
      expect(service.isEnumElement(UserRolesEnum, undefined)).toBe(false);
    });
  });

  // ───────────────────── toCapitalCase ─────────────────────

  describe('toCapitalCase', () => {
    it('should capitalize first letter of each word', () => {
      expect(service.toCapitalCase('hello world')).toBe('Hello World');
      expect(service.toCapitalCase('patient')).toBe('Patient');
      expect(service.toCapitalCase('DOCTOR')).toBe('DOCTOR'); // already caps
    });

    it('should handle empty string', () => {
      expect(service.toCapitalCase('')).toBe('');
    });
  });

  // ───────────────────── truncateString ─────────────────────

  describe('truncateString', () => {
    it('should truncate long strings with ellipsis', () => {
      const long = 'This is a very long string that exceeds the limit';
      const result = service.truncateString(long, 10);
      expect(result).toBe('This is a ...');
      expect(result.length).toBeLessThan(long.length);
    });

    it('should not add ellipsis for short strings', () => {
      expect(service.truncateString('short', 20)).toBe('short');
    });

    it('should use default maxLength of 20', () => {
      const long = 'A'.repeat(25);
      const result = service.truncateString(long);
      expect(result).toBe('A'.repeat(20) + '...');
    });
  });

  // ───────────────────── approximate ─────────────────────

  describe('approximate', () => {
    it('should floor by default with precision 2', () => {
      expect(service.approximate(3.14159)).toBe(3.14);
    });

    it('should round when method is round', () => {
      expect(service.approximate(3.145, 'round', 2)).toBe(3.15);
    });

    it('should ceil when method is ceil', () => {
      expect(service.approximate(3.141, 'ceil', 2)).toBe(3.15);
    });

    it('should handle different precisions', () => {
      expect(service.approximate(3.14159, 'floor', 3)).toBe(3.141);
      expect(service.approximate(3.14159, 'floor', 0)).toBe(3);
    });
  });

  // ───────────────────── generateRandomNumberInRange ─────────────────────

  describe('generateRandomNumberInRange', () => {
    it('should generate number within range', () => {
      for (let i = 0; i < 50; i++) {
        const num = service.generateRandomNumberInRange(1, 10);
        expect(num).toBeGreaterThanOrEqual(1);
        expect(num).toBeLessThan(10);
      }
    });

    it('should return integer', () => {
      const num = service.generateRandomNumberInRange(1, 100);
      expect(Number.isInteger(num)).toBe(true);
    });
  });
});
