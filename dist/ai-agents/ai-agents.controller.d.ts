import { FastifyRequest, FastifyReply } from 'fastify';
import { User } from '@prisma/client';
import { BotpressService } from './botpress.service';
export declare class AiAgentsController {
    private readonly aiService;
    constructor(aiService: BotpressService);
    start(user: User): Promise<{
        conversationId: string;
    }>;
    send(user: User, body: {
        conversationId: string;
        text: string;
    }): Promise<void>;
    stream(req: FastifyRequest, reply: FastifyReply, user: User, conversationId: string): Promise<void>;
}
