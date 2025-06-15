import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RandomGeneratorCharset, UtilsService } from './utils.service';

describe('UtilsService', () => {
  let service: UtilsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UtilsService, ConfigService],
    }).compile();

    service = module.get<UtilsService>(UtilsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a random string of default length 12 and charset ALPHANUMERIC', () => {
    const result = service.generateRandomString();
    expect(result).toHaveLength(12);
    expect(/^[a-zA-Z0-9]+$/.test(result)).toBeTruthy();
  });

  it('should generate a random string of specified length', () => {
    const result = service.generateRandomString(20);
    expect(result).toHaveLength(20);
  });

  it('should generate a random string of specified charset', () => {
    const result = service.generateRandomString(
      12,
      RandomGeneratorCharset.ALPHABETIC,
    );
    expect(/^[a-zA-Z]+$/.test(result)).toBeTruthy();
  });

  it('should generate a random string of specified length and charset', () => {
    const result = service.generateRandomString(
      20,
      RandomGeneratorCharset.ALPHABETIC,
    );
    expect(result).toHaveLength(20);
    expect(/^[a-zA-Z]+$/.test(result)).toBeTruthy();
  });

  it('should hash a string', async () => {
    const str = 'password';
    const hashedStr = await service.getHash(str);
    expect(hashedStr).not.toEqual(str);
    expect(hashedStr).toHaveLength(60); // bcrypt hashes are 60 characters long
  });

  it('should compare a string with a hashed password', async () => {
    const str = 'password';
    const hashedStr = await service.getHash(str);
    const isMatch = await service.compareHash(str, hashedStr);
    expect(isMatch).toBeTruthy();
  });

  it('should generate a random six digit string', () => {
    const result = service.generateRandomSixDigitString();
    expect(result).toHaveLength(6);
    expect(/^[0-9]{6}$/.test(result)).toBeTruthy();
  });

  it('should generate a random number in range', () => {
    const min = 1;
    const max = 10;
    const result = service.generateRandomNumberInRange(min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThan(max);
  });
});
