"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateUserDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const basic_user_roles_enum_1 = require("../enums/basic-user-roles.enum");
const is_enum_detailed_decorator_1 = require("../../common/decorators/is-enum-detailed.decorator");
class UpdateUserDto {
}
exports.UpdateUserDto = UpdateUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'User email' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: 'Email field must be a valid email address!' }),
    (0, class_validator_1.MaxLength)(256, {
        message: 'Email address can not be longer than 256 characters!',
    }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The displaying name of the user' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MinLength)(3, { message: 'First name is too short!' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "firstname", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The displaying lastname of the user' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MinLength)(3, { message: 'Last name is too short!' }),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "lastname", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Directly set user to be private.',
        example: false,
        type: 'boolean',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateUserDto.prototype, "isPrivate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'User avatar',
        example: 'https://example.com/image.png',
        type: 'string',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "avatar", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: basic_user_roles_enum_1.BasicUserRoles,
        enumName: 'BasicUserRoles',
        example: basic_user_roles_enum_1.BasicUserRoles.PATIENT,
        default: basic_user_roles_enum_1.BasicUserRoles.PATIENT,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, is_enum_detailed_decorator_1.IsEnumDetailed)(basic_user_roles_enum_1.BasicUserRoles, 'role'),
    __metadata("design:type", String)
], UpdateUserDto.prototype, "role", void 0);
//# sourceMappingURL=update-user.dto.js.map