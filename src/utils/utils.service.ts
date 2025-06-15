import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { ConfigService } from '@nestjs/config';

type ApproximationMethods = 'floor' | 'round' | 'ceil';

@Injectable()
export class UtilsService {
  private readonly saltRounds: number;

  constructor(readonly configService: ConfigService) {
    this.saltRounds = +configService.get<number>('auth.saltRounds', 12);
  }

  async getHash(str: string) {
    return hash(str, this.saltRounds);
  }

  compareHash(str: string, hashedPassword: string) {
    return compare(str, hashedPassword);
  }

  generateRandomNumberInRange(min: number, max: number) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  approximate(
    num: number,
    method: ApproximationMethods = 'floor',
    precision: number = 2,
  ) {
    const precisionTenth = 10 ** precision;
    return Math[method](num * precisionTenth) / precisionTenth;
  }

  toCapitalCase(word: string) {
    return word.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  truncateString(str: string, maxLength: number = 20) {
    return str.substring(0, maxLength) + (str.length > maxLength ? '...' : '');
  }

  isEnumElement<T>(enumObj: T, value: unknown): value is T {
    return Object.values(enumObj).includes(value as T);
  }
}
