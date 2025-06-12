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
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_1 = require("openai");
const openai_roles_enum_1 = require("./enums/openai-roles.enum");
let ChatService = class ChatService {
    constructor(configService) {
        this.configService = configService;
        this.primaryPrompt = 'You are a medical assistant. Your job is to talk to patients, ask questions, and build a SOAP note. After gathering enough data, diagnose the illness or suggest further testing. Format your answer clearly with sections for Subjective, Objective, Assessment, and Plan.';
        this.tempHistory = {};
        this.modelName = configService.getOrThrow('openai.model');
        this.openaiClient = new openai_1.default({
            apiKey: configService.getOrThrow('openai.key'),
        });
    }
    async getChatHistory(chatId) {
        let chat = this.tempHistory?.[chatId];
        if (!chat?.length) {
            this.tempHistory[chatId] = chat = [
                {
                    role: openai_roles_enum_1.OpenAiChatRoles.SYSTEM,
                    content: this.primaryPrompt,
                },
            ];
        }
        return chat;
    }
    async updateChat(chatId, newMessages) {
        let chat = await this.getChatHistory(chatId);
        chat.push(...newMessages);
    }
    async runCompletion(chatId, prompt) {
        const result = await this.openaiClient.chat.completions.create({
            model: this.modelName,
            messages: [
                ...(await this.getChatHistory(chatId)),
                { role: openai_roles_enum_1.OpenAiChatRoles.USER, content: prompt },
            ],
        });
        await this.updateChat(chatId, [
            { role: openai_roles_enum_1.OpenAiChatRoles.USER, content: prompt },
            {
                role: openai_roles_enum_1.OpenAiChatRoles.SYSTEM,
                content: result.choices[0].message.content,
            },
        ]);
        return result;
    }
    async openNewChat(userId, message) {
        return (await this.runCompletion(userId.toString(), message)).choices[0]
            .message.content;
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ChatService);
//# sourceMappingURL=chat.service.js.map