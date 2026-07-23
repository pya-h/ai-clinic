import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { TOpenAiMessage } from './types/openai-message.type';
import { OpenAiChatRoles } from './enums/openai-roles.enum';

@Injectable()
export class OpenAiService {
  private openaiClient: OpenAI | null = null;
  private readonly modelName: string;
  private readonly primaryPrompt =
    'You are a medical assistant. Your job is to talk to patients, ask questions, and build a SOAP note. After gathering enough data, diagnose the illness or suggest further testing. Format your answer clearly with sections for Subjective, Objective, Assessment, and Plan.';

  constructor(readonly configService: ConfigService) {
    const apiKey = configService.get<string>('openai.key');
    const model = configService.get<string>('openai.model');
    if (apiKey && model) {
      this.modelName = model;
      this.openaiClient = new OpenAI({ apiKey });
    } else {
      this.modelName = '';
      new Logger('OpenAiService').warn(
        'OpenAI not configured — AI completion features disabled',
      );
    }
  }

  private static readonly MAX_HISTORY_ENTRIES = 500;
  private static readonly MAX_MESSAGES_PER_CHAT = 100;
  private tempHistory = new Map<string, TOpenAiMessage[]>();

  async getChatHistory(chatId: string) {
    let chat = this.tempHistory.get(chatId);
    if (!chat?.length) {
      chat = [
        {
          role: OpenAiChatRoles.SYSTEM,
          content: this.primaryPrompt,
        },
      ];
      if (this.tempHistory.size >= OpenAiService.MAX_HISTORY_ENTRIES) {
        const oldest = this.tempHistory.keys().next().value;
        if (oldest !== undefined) this.tempHistory.delete(oldest);
      }
      this.tempHistory.set(chatId, chat);
    }
    return chat;
  }

  async updateChat(chatId: string, newMessages: TOpenAiMessage[]) {
    const chat = await this.getChatHistory(chatId);
    chat.push(...newMessages);
    if (chat.length > OpenAiService.MAX_MESSAGES_PER_CHAT) {
      const system = chat[0];
      const trimmed = chat.slice(chat.length - OpenAiService.MAX_MESSAGES_PER_CHAT + 1);
      trimmed.unshift(system);
      this.tempHistory.set(chatId, trimmed);
    }
  }

  async runCompletion(chatId: string, prompt: string) {
    if (!this.openaiClient) {
      throw new ServiceUnavailableException('OpenAI service is not configured.');
    }
    const result = await this.openaiClient.chat.completions.create({
      model: this.modelName,
      messages: [
        ...(await this.getChatHistory(chatId)),
        { role: OpenAiChatRoles.USER, content: prompt },
      ],
    });
    await this.updateChat(chatId, [
      { role: OpenAiChatRoles.USER, content: prompt },
      {
        role: OpenAiChatRoles.ASSISTANT,
        content: result.choices[0].message.content ?? '',
      },
    ]);
    return result;
  }

  async openNewChat(userId: string, message: string): Promise<string> {
    // TODO: Create a new chat
    return (await this.runCompletion(userId, message)).choices[0]
      .message.content ?? '';
  }
}
