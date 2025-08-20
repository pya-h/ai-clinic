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
exports.StandardResponse = exports.StandardResponseStatusEnum = void 0;
const swagger_1 = require("@nestjs/swagger");
var StandardResponseStatusEnum;
(function (StandardResponseStatusEnum) {
    StandardResponseStatusEnum["SUCCESS"] = "success";
    StandardResponseStatusEnum["ERROR"] = "error";
})(StandardResponseStatusEnum || (exports.StandardResponseStatusEnum = StandardResponseStatusEnum = {}));
class StandardResponse {
    constructor(status, data, message, fields) {
        this.status = status;
        this.data = data ?? null;
        this.message = message ?? null;
        this.fields = fields ?? null;
    }
}
exports.StandardResponse = StandardResponse;
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: StandardResponseStatusEnum,
        enumName: 'StandardResponseStatusEnum',
        description: 'Response status',
        default: StandardResponseStatusEnum.SUCCESS,
    }),
    __metadata("design:type", String)
], StandardResponse.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Response actual data',
        nullable: true,
    }),
    __metadata("design:type", Object)
], StandardResponse.prototype, "data", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Specific message of the endpoint call; usually for indicating error messages.',
        nullable: true,
    }),
    __metadata("design:type", String)
], StandardResponse.prototype, "message", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        type: Object,
        description: 'Additional fields providing detailed information',
        nullable: true,
    }),
    __metadata("design:type", Object)
], StandardResponse.prototype, "fields", void 0);
//# sourceMappingURL=standard-response.js.map