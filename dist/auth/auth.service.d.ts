import { UserLoginDto } from './dto/login.dto';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterationDto } from './dto/register.dto';
import { User } from '@prisma/client';
import { UtilsService } from 'src/utils/utils.service';
export declare class AuthService {
    private readonly userService;
    private readonly jwtService;
    private readonly utilsService;
    constructor(userService: UserService, jwtService: JwtService, utilsService: UtilsService);
    getJwtToken(user: User): string;
    verifyAndLogin({ email, password }: UserLoginDto): Promise<{
        token: string;
        id: string;
    }>;
    register(data: RegisterationDto): Promise<{
        token: string;
        id: string;
    }>;
}
