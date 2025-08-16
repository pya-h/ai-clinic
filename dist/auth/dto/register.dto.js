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
exports.RegisterationDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const swagger_1 = require("@nestjs/swagger");
const is_enum_detailed_decorator_1 = require("../../common/decorators/is-enum-detailed.decorator");
const basic_user_roles_enum_1 = require("../../user/enums/basic-user-roles.enum");
class RegisterationDto {
}
exports.RegisterationDto = RegisterationDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'User email',
        example: 'example@example.com',
        type: 'string',
    }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Email field is required!' }),
    (0, class_validator_1.IsEmail)({}, { message: 'Email field is not a valid email address!' }),
    (0, class_transformer_1.Transform)(({ value }) => value?.toLowerCase()),
    __metadata("design:type", String)
], RegisterationDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'User first name',
        example: 'John',
        type: 'string',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'First name field is required!' }),
    __metadata("design:type", String)
], RegisterationDto.prototype, "firstname", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'User last name',
        example: 'Doe',
        type: 'string',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Last name field is required!' }),
    __metadata("design:type", String)
], RegisterationDto.prototype, "lastname", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Directly set user to be private.',
        example: false,
        type: 'boolean',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], RegisterationDto.prototype, "isPrivate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'User avatar',
        example: 'https://example.com/image.png',
        type: 'string',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)(),
    __metadata("design:type", String)
], RegisterationDto.prototype, "avatar", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        enum: basic_user_roles_enum_1.BasicUserRoles,
        enumName: 'BasicUserRoles',
        example: basic_user_roles_enum_1.BasicUserRoles.PATIENT,
        type: 'string',
        default: basic_user_roles_enum_1.BasicUserRoles.PATIENT,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, is_enum_detailed_decorator_1.IsEnumDetailed)(basic_user_roles_enum_1.BasicUserRoles, 'role'),
    __metadata("design:type", String)
], RegisterationDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'User password',
        example: '1NormalPass',
        type: 'string',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}$/, {
        message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter and one digit',
    }),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password field is required!' }),
    __metadata("design:type", String)
], RegisterationDto.prototype, "password", void 0);
//# sourceMappingURL=register.dto.js.map