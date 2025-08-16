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
exports.UserService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
const utils_service_1 = require("../utils/utils.service");
let UserService = class UserService {
    constructor(prisma, utilsService) {
        this.prisma = prisma;
        this.utilsService = utilsService;
    }
    getById(id) {
        return this.prisma.user.findUnique({
            where: { id },
        });
    }
    async userExists(userId) {
        return Boolean(await this.getById(userId));
    }
    async emailExists(email) {
        return Boolean(await this.getBy({ email }));
    }
    getBy(identifier) {
        const { id, email } = identifier;
        if (id != null)
            return this.prisma.user.findUnique({
                where: { id },
            });
        if (email)
            return this.prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
            });
        throw new common_1.BadRequestException('Invalid arguments for finding a user');
    }
    async createUser(userData) {
        if (await this.emailExists(userData.email)) {
            throw new common_1.ForbiddenException('Email is unavailable!');
        }
        if (!this.utilsService.isEnumElement(client_1.UserRoles, userData.role)) {
            throw new common_1.BadRequestException('Invalid role!');
        }
        const hashedPassword = await this.utilsService.getHash(userData.password);
        const user = await this.prisma.user.create({
            data: {
                firstname: userData.firstname,
                lastname: userData.lastname,
                email: userData.email,
                role: userData.role || client_1.UserRoles.PATIENT,
                isAdmin: false,
                password: hashedPassword,
                isPrivate: userData.isPrivate || false,
                avatar: userData.avatar || null,
            },
        });
        return user;
    }
    async updateUser(user, updateUserData) {
        if (!Object.keys(updateUserData)?.length)
            throw new common_1.BadRequestException('Provide some new data to continue modifying user data.');
        if (updateUserData.email &&
            (await this.emailExists(updateUserData.email))) {
            throw new common_1.ConflictException('This email is used before.');
        }
        return this.prisma.user.update({
            where: { id: user.id },
            data: {
                ...updateUserData,
            },
        });
    }
    getUsers() {
        return this.prisma.user.findMany({
            where: { isAdmin: false },
        });
    }
};
exports.UserService = UserService;
exports.UserService = UserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, utils_service_1.UtilsService])
], UserService);
//# sourceMappingURL=user.service.js.map