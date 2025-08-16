import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterationDto } from 'src/auth/dto/register.dto';
import { UtilsService } from 'src/utils/utils.service';
export declare class UserService {
    private readonly prisma;
    private readonly utilsService;
    constructor(prisma: PrismaService, utilsService: UtilsService);
    getById(id: number): Prisma.Prisma__UserClient<{
        id: number;
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
    }, null, import("@prisma/client/runtime/library").DefaultArgs, Prisma.PrismaClientOptions>;
    userExists(userId: number): Promise<boolean>;
    emailExists(email: string): Promise<boolean>;
    getBy(identifier: {
        id?: number;
        email?: string;
    }): Prisma.Prisma__UserClient<{
        id: number;
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
    }, null, import("@prisma/client/runtime/library").DefaultArgs, Prisma.PrismaClientOptions>;
    createUser(userData?: RegisterationDto): Promise<{
        id: number;
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
    updateUser(user: User, updateUserData: UpdateUserDto): Promise<{
        id: number;
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
    getUsers(): Prisma.PrismaPromise<{
        id: number;
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
}
