import { ConfigService } from '@nestjs/config';
import { JwtTokenPayloadDto } from '../dto/jwt-token-payload.dto';
import { UserService } from '../../user/user.service';
declare const JwtAuthStrategy_base: new (...args: any) => any;
export declare class JwtAuthStrategy extends JwtAuthStrategy_base {
    private readonly userService;
    constructor(userService: UserService, configService: ConfigService);
    validate({ sub, email }: JwtTokenPayloadDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        firstname: string;
        lastname: string;
        role: import(".prisma/client").$Enums.UserRoles;
        isAdmin: boolean;
        isPrivate: boolean;
        avatar: string | null;
        password: string;
    }>;
}
export {};
