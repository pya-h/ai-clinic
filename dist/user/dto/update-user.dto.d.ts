import { BasicUserRoles } from '../enums/basic-user-roles.enum';
export declare class UpdateUserDto {
    email?: string;
    firstname?: string;
    lastname?: string;
    isPrivate: boolean;
    avatar?: string;
    role?: BasicUserRoles;
}
