import { BasicUserRoles } from 'src/user/enums/basic-user-roles.enum';
export declare class RegisterationDto {
    email: string;
    firstname: string;
    lastname: string;
    isPrivate: boolean;
    avatar?: string;
    role?: BasicUserRoles;
    password: string;
}
