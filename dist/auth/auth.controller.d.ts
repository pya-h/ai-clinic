import { AuthService } from './auth.service';
import { UserLoginDto } from './dto/login.dto';
import { RegisterationDto } from './dto/register.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    authenticate(authData: UserLoginDto): Promise<{
        token: string;
        id: string;
    }>;
    register(RegisterationDto: RegisterationDto): Promise<{
        token: string;
        id: string;
    }>;
}
