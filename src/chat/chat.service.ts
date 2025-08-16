import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// import OpenAI from 'openai';
import { TOpenAiMessage } from './types/openai-message.type';
import { OpenAiChatRoles } from './enums/openai-roles.enum';

@Injectable()
export class ChatService {
  private openaiClient: any;
  private readonly modelName: string;
  private readonly primaryPrompt =
    'You are a medical assistant. Your job is to talk to patients, ask questions, and build a SOAP note. After gathering enough data, diagnose the illness or suggest further testing. Format your answer clearly with sections for Subjective, Objective, Assessment, and Plan.';

  constructor(readonly configService: ConfigService) {
    this.modelName = configService.getOrThrow<string>('openai.model');
    // this.openaiClient = new OpenAI({
    //   apiKey: configService.getOrThrow<string>('openai.key'),
    // });
  }

  private tempHistory: Record<string, TOpenAiMessage[]> = {};

  async getChatHistory(chatId: string) {
    let chat = this.tempHistory?.[chatId];
    if (!chat?.length) {
      this.tempHistory[chatId] = chat = [
        {
          role: OpenAiChatRoles.SYSTEM,
          content: this.primaryPrompt,
        },
      ];
    }
    return chat;
  }

  async updateChat(chatId: string, newMessages: TOpenAiMessage[]) {
    let chat = await this.getChatHistory(chatId);
    chat.push(...newMessages);
  }

  async runCompletion(chatId: string, prompt: string) {
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
        role: OpenAiChatRoles.SYSTEM,
        content: result.choices[0].message.content,
      },
    ]);
    return result;
  }

  async openNewChat(userId: number, message: string) {
    // TODO: Create a new chat
    return (await this.runCompletion(userId.toString(), message)).choices[0]
      .message.content;
  }
}
