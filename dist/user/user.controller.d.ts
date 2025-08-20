import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from '@prisma/client';
export declare class UserController {
    private readonly userService;
    constructor(userService: UserService);
    getMe(user: User): {
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
    };
    getUsers(): import(".prisma/client").Prisma.PrismaPromise<{
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
    }[]>;
    updateUserData(user: User, updateUserData: UpdateUserDto): Promise<{
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
    getUser(currentUser: User, id: string): Promise<{
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
