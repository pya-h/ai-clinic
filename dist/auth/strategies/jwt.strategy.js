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
exports.JwtAuthStrategy = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const user_service_1 = require("../../user/user.service");
let JwtAuthStrategy = class JwtAuthStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    constructor(userService, configService) {
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow('auth.jwtSecret'),
            issuer: configService.get('auth.jwtIssuer'),
        });
        this.userService = userService;
    }
    async validate({ sub, email }) {
        const user = await this.userService.getById(+sub);
        if (!user || user.email !== email)
            throw new common_1.UnauthorizedException('Invalid token provided.');
        return user;
    }
};
exports.JwtAuthStrategy = JwtAuthStrategy;
exports.JwtAuthStrategy = JwtAuthStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [user_service_1.UserService,
        config_1.ConfigService])
], JwtAuthStrategy);
//# sourceMappingURL=jwt.strategy.js.map