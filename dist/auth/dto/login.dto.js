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
exports.UserLoginDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class UserLoginDto {
}
exports.UserLoginDto = UserLoginDto;
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
], UserLoginDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'User password',
        example: '1NormalPass',
        type: 'string',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Password field is required!' }),
    __metadata("design:type", String)
], UserLoginDto.prototype, "password", void 0);
//# sourceMappingURL=login.dto.js.map