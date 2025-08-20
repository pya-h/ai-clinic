import { ConfigService } from '@nestjs/config';
import * as chat from '@botpress/chat';
import { User } from '@prisma/client';
export declare class BotpressService {
    readonly configService: ConfigService;
    private readonly logger;
    private readonly webhookId;
    private readonly users;
    constructor(configService: ConfigService);
    private getClient;
    ensureConversation(user: User): Promise<{
        conversationId: string;
    }>;
    start(user: User): Promise<{
        conversationId: string;
    }>;
    send(user: User, conversationId: string, text: string): Promise<void>;
    listen(user: User, conversationId: string): Promise<{
        client: chat.AuthenticatedClient;
        listener: chat.SignalListener;
    }>;
}
