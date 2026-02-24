import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { ConfigService } from '@nestjs/config';

type ApproximationMethods = 'floor' | 'round' | 'ceil';

@Injectable()
export class UtilsService {
  private readonly saltRounds: number;

  constructor(private readonly configService: ConfigService) {
    this.saltRounds = +configService.get<number>('auth.saltRounds', 12);
  }

  async getHash(str: string): Promise<string> {
    return hash(str, this.saltRounds);
  }

  async compareHash(str: string, hashedPassword: string): Promise<boolean> {
    return compare(str, hashedPassword);
  }

  generateRandomNumberInRange(min: number, max: number): number {
    if (min > max) {
      [min, max] = [max, min];
    }
    return Math.floor(Math.random() * (max - min)) + min;
  }

  approximate(
    num: number,
    method: ApproximationMethods = 'floor',
    precision: number = 2,
  ): number {
    const precisionTenth = 10 ** precision;
    return Math[method](num * precisionTenth) / precisionTenth;
  }

  toCapitalCase(word: string): string {
    return word.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  truncateString(str: string, maxLength: number = 20): string {
    return str.substring(0, maxLength) + (str.length > maxLength ? '...' : '');
  }

  isEnumElement<T extends Record<string, unknown>>(
    enumObj: T,
    value: unknown,
  ): value is T[keyof T] {
    return Object.values(enumObj).includes(value);
  }
}
