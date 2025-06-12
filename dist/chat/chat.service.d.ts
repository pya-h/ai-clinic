import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
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
    runCompletion(chatId: string, prompt: string): Promise<OpenAI.Chat.Completions.ChatCompletion & {
        _request_id?: string | null;
    }>;
    openNewChat(userId: number, message: string): Promise<string>;
}
