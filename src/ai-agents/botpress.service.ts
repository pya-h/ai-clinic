import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as chat from '@botpress/chat';
import { User, AiConversations } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface UserContext {
  client: chat.AuthenticatedClient;
  /** Prefer reuse: one conversation per user (or you can map per-channel/thread). */
  conversationId?: string;
}

// TODO: Save conversationId in the database per user
// TODO: Add multi conversations per user support
// TODO: Add File Communications.

// TODO: Add Http Polling mechanism as A Plan B in case SSE not works well for a client.
@Injectable()
export class BotpressService {
  private readonly logger = new Logger(BotpressService.name);
  private readonly webhookId: string;
  private readonly users = new Map<string, UserContext>();

  constructor(
    readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.webhookId = configService.get<string>('botpress.webhookId');
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Bot Agent Key is missing');
    }
  }

  private async getClient(user: User): Promise<UserContext> {
    const existing = this.users.get(user.id);
    if (existing) return existing;

    // creates a Chat-API "user" under the hood
    const client = await chat.Client.connect({ webhookId: this.webhookId });

    const ctx: UserContext = { client };
    this.users.set(user.id, ctx);
    this.logger.debug(
      `connected Botpress client for user=${user} bpUser=${client.user.id}`,
    );
    return ctx;
  }

  async ensureConversation(user: User): Promise<AiConversations> {
    const ctx = await this.getClient(user);
    if (!ctx.conversationId) {
      const { conversation } = await ctx.client.createConversation({});
      ctx.conversationId = conversation.id;
      this.logger.debug(
        `created conversation=${conversation.id} for user=${user}`,
      );
    }
    return this.prismaService.aiConversations.upsert({
      where: { userId: user.id, id: ctx.conversationId },
      create: { userId: user.id, id: ctx.conversationId },
      update: {},
    });
  }

  start(user: User) {
    return this.ensureConversation(user);
  }

  async send(user: User, conversationId: string, text: string): Promise<void> {
    const { client } = await this.getClient(user);
    await client.createMessage({
      conversationId,
      payload: { type: 'text', text },
    });
  }

  async listen(user: User, conversationId: string) {
    const { client } = await this.getClient(user);
    // The SDK wraps Chat API's GET /conversations/:id/listen (SSE). :contentReference[oaicite:1]{index=1}
    const listener = await client.listenConversation({ id: conversationId });
    return { client, listener };
  }
}
