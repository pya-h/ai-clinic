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
exports.JwtTokenPayloadDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class JwtTokenPayloadDto {
}
exports.JwtTokenPayloadDto = JwtTokenPayloadDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Id of the user as payload subject',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", String)
], JwtTokenPayloadDto.prototype, "sub", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: true }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], JwtTokenPayloadDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Jwt expiry related data.' }),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], JwtTokenPayloadDto.prototype, "iat", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Jwt expiry related data.' }),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], JwtTokenPayloadDto.prototype, "exp", void 0);
//# sourceMappingURL=jwt-token-payload.dto.js.map