import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as chat from '@botpress/chat';
import { User, AiConversations } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ConversationListener = Awaited<
  ReturnType<chat.AuthenticatedClient['listenConversation']>
>;

interface UserContext {
  client: chat.AuthenticatedClient;
  conversationId?: string;
  listener?: ConversationListener;
}
// TODO: Save conversations, chats and then SOAPs in database.

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
    if (existing) {
      return existing;
    }

    this.logger.debug(`Creating new Botpress client for user ${user.id}`);
    const client = await chat.Client.connect({
      webhookId: this.webhookId,
      debug: true,
    });

    const ctx: UserContext = { client };
    this.users.set(user.id, ctx);
    this.logger.log(`Connected Botpress client for user ${user.id}`);
    return ctx;
  }

  async ensureConversation(user: User): Promise<AiConversations> {
    const ctx = await this.getClient(user);

    // Check if we have a conversation ID in context
    if (ctx.conversationId) {
      const existing = await this.prismaService.aiConversations.findUnique({
        where: { id: ctx.conversationId },
      });
      if (existing) {
        return existing;
      }
      // If conversation doesn't exist in DB, clear it from context
      ctx.conversationId = undefined;
    }

    // Check database for existing conversation
    const dbConversation = await this.prismaService.aiConversations.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (dbConversation) {
      // Verify conversation still exists in Botpress
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

    // Create new conversation
    this.logger.debug(`Creating new conversation for user ${user.id}`);
    const { conversation } = await ctx.client.createConversation({});
    ctx.conversationId = conversation.id;

    return this.prismaService.aiConversations.create({
      data: { userId: user.id, id: ctx.conversationId },
    });
  }

  start(user: User) {
    return this.ensureConversation(user).catch((error) => {
      this.logger.error(
        `Failed to ensure conversation for user ${user.id}:`,
        error,
      );
      throw error;
    });
  }

  async getConversationId(user: User): Promise<string> {
    const ctx = await this.getClient(user);
    if (ctx.conversationId) {
      return ctx.conversationId;
    }

    // If not in context, check database
    const conversation = await this.ensureConversation(user);
    return conversation.id;
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
    listener: ConversationListener;
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

    // Reuse existing listener if it's still connected
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

  async releaseListener(userId: string, listener?: ConversationListener) {
    const ctx = this.users.get(userId);
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
  cleanupUserContext(userId: string): void {
    const ctx = this.users.get(userId);
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
    this.users.delete(userId);
    this.logger.debug(`Cleaned up context for user ${userId}`);
  }

  // Method to poll for new messages (workaround for SSE issues)
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
