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
exports.UtilsService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt_1 = require("bcrypt");
const config_1 = require("@nestjs/config");
let UtilsService = class UtilsService {
    constructor(configService) {
        this.configService = configService;
        this.saltRounds = +configService.get('auth.saltRounds', 12);
    }
    async getHash(str) {
        return (0, bcrypt_1.hash)(str, this.saltRounds);
    }
    compareHash(str, hashedPassword) {
        return (0, bcrypt_1.compare)(str, hashedPassword);
    }
    generateRandomNumberInRange(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }
    approximate(num, method = 'floor', precision = 2) {
        const precisionTenth = 10 ** precision;
        return Math[method](num * precisionTenth) / precisionTenth;
    }
    toCapitalCase(word) {
        return word.replace(/\b\w/g, (char) => char.toUpperCase());
    }
    truncateString(str, maxLength = 20) {
        return str.substring(0, maxLength) + (str.length > maxLength ? '...' : '');
    }
    isEnumElement(enumObj, value) {
        return Object.values(enumObj).includes(value);
    }
};
exports.UtilsService = UtilsService;
exports.UtilsService = UtilsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], UtilsService);
//# sourceMappingURL=utils.service.js.map