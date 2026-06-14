import {
  BadRequestException,
    Injectable,
  Logger,
  NotFoundException,
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

@Injectable()
export class BotpressService {
  private readonly logger = new Logger(BotpressService.name);
  private readonly webhookId: string;
  readonly deliveryMode: 'sse' | 'poll';
  private readonly cachingOptions = { group: 'bp-ctx', ttl: 300000 }; // 5 minutes
  private readonly guestTtlMs = 30 * 60 * 1000;
  private readonly guestContexts = new Map<
    string,
    {
      client: chat.AuthenticatedClient;
      expiresAt: number;
    }
  >();
  // Deduplicates concurrent getClient() calls for the same user (race-condition guard)
  private readonly pendingClientCreations = new Map<string, Promise<IUserContext>>();
  // Persists Botpress userKey so we can reconnect to the same Botpress identity
  // after the in-memory cache expires, preserving conversation continuity.
  private readonly userKeys = new Map<string, string>();

  constructor(
    readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    this.webhookId = configService.get<string>('botpress.webhookId');
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Bot Agent Key is missing');
    }
    this.deliveryMode = configService.get<'sse' | 'poll'>('botpress.deliveryMode') ?? 'sse';
    this.logger.log(`Botpress delivery mode: ${this.deliveryMode}`);
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

    // Deduplicate: if another concurrent call is already creating the client for
    // this user, wait for that same promise instead of creating a second client.
    const pending = this.pendingClientCreations.get(user.id);
    if (pending) {
      return pending;
    }

    const creationPromise = (async () => {
      // Reuse the Botpress userKey if we have one from a previous session.
      // This preserves the same Botpress identity so old conversations remain accessible.
      const savedKey = this.userKeys.get(user.id);

      const client = await chat.Client.connect({
        webhookId: this.webhookId,
        debug: false,
        ...(savedKey ? { userKey: savedKey } : {}),
      });

      // Persist the key for future reconnections
      if (client.user?.key) {
        this.userKeys.set(user.id, client.user.key);
      }

      const ctx = await this.cacheService.set<IUserContext>(
        this.cachingOptions.group,
        user.id,
        { client },
        this.cachingOptions.ttl,
      );

      return ctx;
    })();

    this.pendingClientCreations.set(user.id, creationPromise);
    creationPromise.finally(() => this.pendingClientCreations.delete(user.id));
    return creationPromise;
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

    const { conversation } = await ctx.client.createConversation({});
    ctx.conversationId = conversation.id;

    return this.prismaService.aiConversation.create({
      data: { userId: user.id, id: ctx.conversationId },
    });
  }

  async start(user: User) {
    try {
      return await this.getConversation(user);
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

  async startGuest(): Promise<{ id: string; guest: true }> {
    this.pruneGuestContexts();

    const client = await chat.Client.connect({
      webhookId: this.webhookId,
      debug: false,
    });

    const { conversation } = await client.createConversation({});

    this.guestContexts.set(conversation.id, {
      client,
      expiresAt: Date.now() + this.guestTtlMs,
    });

    return { id: conversation.id, guest: true };
  }

  async send(user: User, conversationId: string, text: string): Promise<void> {
    const ctx = await this.getClient(user);

    try {
      await ctx.client.createMessage({
        conversationId,
        payload: { type: 'text', text },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send message to conversation ${conversationId}:`,
        error,
      );
      throw error;
    }
  }

  async sendGuest(conversationId: string, text: string): Promise<void> {
    this.pruneGuestContexts();

    const guestCtx = this.guestContexts.get(conversationId);
    if (!guestCtx) {
      throw new NotFoundException('Guest conversation not found or expired.');
    }

    if (!text?.trim()) {
      throw new BadRequestException('Message text is required.');
    }

    await guestCtx.client.createMessage({
      conversationId,
      payload: { type: 'text', text },
    });

    guestCtx.expiresAt = Date.now() + this.guestTtlMs;
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
      await this.releaseListener(user.id, ctx.listener);
    }

    if (ctx.listener && ctx.listener.status === 'connected') {
      return { client: ctx.client, listener: ctx.listener };
    }

    try {
      if (ctx.listener && ctx.listener.status !== 'connected') {
        await ctx.listener.connect();
        return { client: ctx.client, listener: ctx.listener };
      }

      const listener = await ctx.client.listenConversation({
        id: conversationId,
      });

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
  }

  // workaround for SSE issues
  async pollForNewMessages(
    user: User,
    conversationId: string,
    dateOffset?: Date,
  ): Promise<any[]> {
    const ctx = await this.getClient(user);
    return this.pollFromClient(ctx.client, conversationId, dateOffset);
  }

  /**
   * Poll for guest conversation messages (no auth required).
   */
  async pollGuestMessages(
    conversationId: string,
    dateOffset?: Date,
  ): Promise<any[]> {
    this.pruneGuestContexts();
    const guestCtx = this.guestContexts.get(conversationId);
    if (!guestCtx) {
      throw new NotFoundException('Guest conversation not found or expired.');
    }
    guestCtx.expiresAt = Date.now() + this.guestTtlMs;
    return this.pollFromClient(guestCtx.client, conversationId, dateOffset);
  }

  /**
   * Shared poll logic — fetches all pages via nextToken cursor pagination.
   */
  private async pollFromClient(
    client: chat.AuthenticatedClient,
    conversationId: string,
    dateOffset?: Date,
  ): Promise<any[]> {
    try {
      const allMessages: any[] = [];
      let nextToken: string | undefined;

      // Paginate through all message pages
      do {
        const page = await client.listMessages({
          conversationId,
          ...(nextToken ? { nextToken } : {}),
        });
        allMessages.push(...page.messages);
        nextToken = (page as any).meta?.nextToken;
      } while (nextToken);

      const dateCheck = dateOffset
        ? (date: Date | string) => new Date(date) > dateOffset
        : () => true;

      return allMessages.filter(
        (msg) => msg.userId !== client.user.id && dateCheck(msg.createdAt),
      );
    } catch (error) {
      this.logger.error(`Error polling for messages:`, error);
      return [];
    }
  }

  /**
   * Extract displayable text from any Botpress message payload.
   * Handles both `text` and `markdown` payload types.
   */
  static extractPayloadText(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const p = payload as Record<string, unknown>;
    if (typeof p.text === 'string') return p.text;
    if (typeof p.markdown === 'string') return p.markdown;
    return undefined;
  }

  private pruneGuestContexts(): void {
    const now = Date.now();
    for (const [conversationId, context] of this.guestContexts.entries()) {
      if (context.expiresAt <= now) {
        this.guestContexts.delete(conversationId);
      }
    }
  }
}
