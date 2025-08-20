import { ConfigService } from '@nestjs/config';
import { TOpenAiMessage } from './types/openai-message.type';
export declare class ChatService {
    readonly configService: ConfigService;
    private openaiClient;
    private readonly modelName;
    private readonly primaryPrompt;
    constructor(configService: ConfigService);
    private tempHistory;
    getChatHistory(chatId: string): Promise<TOpenAiMessage[]>;
    updateChat(chatId: string, newMessages: TOpenAiMessage[]): Promise<void>;
    runCompletion(chatId: string, prompt: string): Promise<any>;
    openNewChat(userId: number, message: string): Promise<any>;
}
