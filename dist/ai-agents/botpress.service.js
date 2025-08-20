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
var BotpressService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotpressService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const chat = require("@botpress/chat");
let BotpressService = BotpressService_1 = class BotpressService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(BotpressService_1.name);
        this.users = new Map();
        this.webhookId = configService.get('botpress.webhookId');
        if (!this.webhookId) {
            throw new common_1.ServiceUnavailableException('Bot Agent Key is missing');
        }
    }
    async getClient(user) {
        const existing = this.users.get(user.id);
        if (existing)
            return existing;
        const client = await chat.Client.connect({ webhookId: this.webhookId });
        const ctx = { client };
        this.users.set(user.id, ctx);
        this.logger.debug(`connected Botpress client for user=${user} bpUser=${client.user.id}`);
        return ctx;
    }
    async ensureConversation(user) {
        const ctx = await this.getClient(user);
        if (ctx.conversationId)
            return { conversationId: ctx.conversationId };
        const { conversation } = await ctx.client.createConversation({});
        ctx.conversationId = conversation.id;
        this.logger.debug(`created conversation=${conversation.id} for user=${user}`);
        return { conversationId: conversation.id };
    }
    async start(user) {
        return this.ensureConversation(user);
    }
    async send(user, conversationId, text) {
        const { client } = await this.getClient(user);
        await client.createMessage({
            conversationId,
            payload: { type: 'text', text },
        });
    }
    async listen(user, conversationId) {
        const { client } = await this.getClient(user);
        const listener = await client.listenConversation({ id: conversationId });
        return { client, listener };
    }
};
exports.BotpressService = BotpressService;
exports.BotpressService = BotpressService = BotpressService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], BotpressService);
//# sourceMappingURL=botpress.service.js.map