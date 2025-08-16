import { ConfigService } from '@nestjs/config';
type ApproximationMethods = 'floor' | 'round' | 'ceil';
export declare class UtilsService {
    readonly configService: ConfigService;
    private readonly saltRounds;
    constructor(configService: ConfigService);
    getHash(str: string): Promise<string>;
    compareHash(str: string, hashedPassword: string): Promise<boolean>;
    generateRandomNumberInRange(min: number, max: number): number;
    approximate(num: number, method?: ApproximationMethods, precision?: number): number;
    toCapitalCase(word: string): string;
    truncateString(str: string, maxLength?: number): string;
    isEnumElement<T>(enumObj: T, value: unknown): value is T;
}
export {};
