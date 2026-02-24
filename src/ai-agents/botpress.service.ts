import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as chat from '@botpress/chat';
import { User, AiConversation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IUserContext,
  TConversationListener,
} from './types/user-client-context.type';
import { CacheService } from '../cache/cache.service';

// TODO: Save conversations, chats and then SOAPs in database.

@Injectable()
export class BotpressService {
  private readonly logger = new Logger(BotpressService.name);
  private readonly webhookId: string;
  private readonly cachingOptions = { group: 'bp-ctx', ttl: 300000 }; // 5 secs

  constructor(
    readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    this.webhookId = configService.get<string>('botpress.webhookId');
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Bot Agent Key is missing');
    }
    this.cacheService.registerDelEvent(
      this.cachingOptions.group,
      this.cleanupUserContext.bind(this),
    );
  }

  private async getClient(user: User, updateCacheDeadline?: boolean): Promise<IUserContext> {
    const existing = await this.cacheService.get<IUserContext>(
      this.cachingOptions.group,
      user.id,
      updateCacheDeadline,
    );
    if (existing) {
      return existing;
    }

    this.logger.debug(`Creating new Botpress client for user ${user.id}`);
    const client = await chat.Client.connect({
      webhookId: this.webhookId,
      debug: false,
    });

    const ctx = await this.cacheService.set<IUserContext>(
      this.cachingOptions.group,
      user.id,
      { client },
      this.cachingOptions.ttl,
    );

    this.logger.log(`Connected Botpress client for user ${user.id}`);
    return ctx;
  }

  async getConversation(user: User, updateCacheDeadline?: boolean): Promise<AiConversation> {
    const ctx = await this.getClient(user, updateCacheDeadline);

    if (ctx.conversationId) {
      const existing = await this.prismaService.aiConversation.findUnique({
        where: { id: ctx.conversationId },
      });
      if (existing) {
        return existing;
      }
      ctx.conversationId = undefined;
    }

    const dbConversation = await this.prismaService.aiConversation.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (dbConversation) {
      try {
        await ctx.client.getConversation({ id: dbConversation.id });
        ctx.conversationId = dbConversation.id;
        return dbConversation;
      } catch (error) {
        this.logger.warn(
          `Conversation ${dbConversation.id} not found in Botpress, creating new one`,
        );
      }
    }

    this.logger.debug(`Creating new conversation for user ${user.id}`);
    const { conversation } = await ctx.client.createConversation({});
    ctx.conversationId = conversation.id;

    return this.prismaService.aiConversation.create({
      data: { userId: user.id, id: ctx.conversationId },
    });
  }

  start(user: User) {
    try {
      return this.getConversation(user);
    } catch (err) {
      this.logger.error(
        `Failed to ensure conversation for user ${user.id}:`,
        err,
      );
      throw new ServiceUnavailableException(
        'Can not start an AI Conversation at the time!',
      );
    }
  }

  async send(user: User, conversationId: string, text: string): Promise<void> {
    const ctx = await this.getClient(user);

    try {
      await ctx.client.createMessage({
        conversationId,
        payload: { type: 'text', text },
      });
      this.logger.debug(`Message sent to conversation ${conversationId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send message to conversation ${conversationId}:`,
        error,
      );
      throw error;
    }
  }

  async listen(
    user: User,
    conversationId: string,
  ): Promise<{
    client: chat.AuthenticatedClient;
    listener: TConversationListener;
  }> {
    const ctx = await this.getClient(user);

    // If we already have a listener but it's for another conversation, disconnect it
    if (
      ctx.listener &&
      ctx.conversationId &&
      ctx.conversationId !== conversationId
    ) {
      this.logger.debug(
        `Existing listener is bound to conversation ${ctx.conversationId}, disconnecting before switching to ${conversationId}`,
      );
      await this.releaseListener(user.id, ctx.listener);
    }

    if (ctx.listener && ctx.listener.status === 'connected') {
      this.logger.debug(
        `Reusing existing listener for conversation ${conversationId}`,
      );
      return { client: ctx.client, listener: ctx.listener };
    }

    try {
      if (ctx.listener && ctx.listener.status !== 'connected') {
        this.logger.debug(
          `Reconnecting listener for conversation ${conversationId}`,
        );
        await ctx.listener.connect();
        this.logger.debug(
          `Listener reconnected for conversation ${conversationId}, status: ${ctx.listener.status}`,
        );
        return { client: ctx.client, listener: ctx.listener };
      }

      this.logger.debug(`Creating listener for conversation ${conversationId}`);
      const listener = await ctx.client.listenConversation({
        id: conversationId,
      });
      this.logger.debug(
        `Listener status for conversation ${conversationId}: ${listener.status}`,
      );

      ctx.listener = listener;
      ctx.conversationId = conversationId;

      listener.on('error', (error) => {
        this.logger.error(
          `Listener error for conversation ${conversationId}:`,
          error,
        );
        if (ctx.listener === listener) {
          ctx.listener = undefined;
        }
      });

      this.logger.log(
        `Listener established for conversation ${conversationId}`,
      );
      return { client: ctx.client, listener };
    } catch (error) {
      this.logger.error(
        `Failed to establish listener for conversation ${conversationId}:`,
        error,
      );
      throw error;
    }
  }

  async releaseListener(userId: string, listener?: TConversationListener) {
    const ctx = await this.cacheService.get<IUserContext>(
      this.cachingOptions.group,
      userId,
    );
    if (!listener || !ctx) {
      try {
        await listener?.disconnect?.();
      } catch (error) {
        this.logger.warn('Error disconnecting orphan listener:', error);
      }
      return;
    }

    if (ctx.listener !== listener) {
      // Listener not tracked anymore, just disconnect
      try {
        await listener.disconnect?.();
      } catch (error) {
        this.logger.warn(
          `Error disconnecting listener for user ${userId}:`,
          error,
        );
      }
      return;
    }

    try {
      await listener.disconnect?.();
    } catch (error) {
      this.logger.warn(
        `Error disconnecting listener for user ${userId}:`,
        error,
      );
    } finally {
      ctx.listener = undefined;
    }
  }

  /**
   * Clean up user context and disconnect listener
   * Useful for cleanup when user disconnects or on errors
   */
  async cleanupUserContext(userId: string) {
    const ctx = await this.cacheService.get<IUserContext>(
      this.cachingOptions.group,
      userId,
    );
    if (ctx?.listener) {
      try {
        ctx.listener.disconnect?.();
      } catch (error) {
        this.logger.warn(
          `Error disconnecting listener for user ${userId}:`,
          error,
        );
      }
    }
    this.logger.debug(`Cleaned up context for user ${userId}`);
  }

  // workaround for SSE issues
  async pollForNewMessages(
    user: User,
    conversationId: string,
    dateOffset?: Date,
  ): Promise<any[]> {
    const ctx = await this.getClient(user);

    try {
      const messages = await ctx.client.listMessages({ conversationId });

      const dateCheck = dateOffset
        ? (date: Date | string) => new Date(date) > dateOffset
        : (..._args: unknown[]) => true;

      const newBotMessages = messages.messages.filter(
        (msg) => msg.userId !== ctx.client.user.id && dateCheck(msg.createdAt),
      );

      return newBotMessages;
    } catch (error) {
      this.logger.error(`Error polling for messages:`, error);
      return [];
    }
  }
}
