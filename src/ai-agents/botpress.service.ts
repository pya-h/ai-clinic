import {
  BadRequestException,
    Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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

  // DB conversation ID → replacement Botpress ID (after Botpress-side expiry)
  private readonly renewedConversations = new Map<string, string>();

  constructor(
    readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    this.webhookId = configService.get<string>('botpress.webhookId') ?? '';
    if (!this.webhookId) {
      this.logger.warn('BOTAGENT_KEY not set — Botpress chat features disabled');
      this.deliveryMode = 'sse';
      return;
    }
    this.deliveryMode = configService.get<'sse' | 'poll'>('botpress.deliveryMode') ?? 'sse';
    this.logger.log(`Botpress delivery mode: ${this.deliveryMode}`);
    this.cacheService.registerDelEvent(
      this.cachingOptions.group,
      this.cleanupUserContext.bind(this),
    );
  }

  private resolveBotpressId(dbConversationId: string): string {
    return this.renewedConversations.get(dbConversationId) ?? dbConversationId;
  }

  private async getClient(user: User, updateCacheDeadline?: boolean): Promise<IUserContext> {
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Botpress chat is not configured.');
    }
    const existing = await this.cacheService.get<IUserContext>(
      this.cachingOptions.group,
      user.id,
      updateCacheDeadline,
    );
    if (existing) {
      return existing;
    }

    const pending = this.pendingClientCreations.get(user.id);
    if (pending) {
      return pending;
    }

    const creationPromise = (async () => {
      const dbUser = await this.prismaService.user.findUnique({
        where: { id: user.id },
        select: { botpressUserKey: true },
      });
      const savedKey = dbUser?.botpressUserKey ?? undefined;

      let client: chat.AuthenticatedClient;

      if (savedKey) {
        try {
          const rawClient = new chat.Client({ webhookId: this.webhookId });
          const { user: bpUser } = await rawClient.getUser({ 'x-user-key': savedKey });
          // Private constructor, but the SDK's own connect() uses it the same way
          client = new (chat.AuthenticatedClient as any)(rawClient, { ...bpUser, key: savedKey }) as chat.AuthenticatedClient;
        } catch {
          this.logger.warn('Saved Botpress key invalid, creating fresh identity');
          client = await chat.Client.connect({ webhookId: this.webhookId });
        }
      } else {
        client = await chat.Client.connect({ webhookId: this.webhookId });
      }

      if (client.user?.key && client.user.key !== savedKey) {
        await this.prismaService.user.update({
          where: { id: user.id },
          data: { botpressUserKey: client.user.key },
        }).catch((err) => this.logger.warn('Failed to persist botpress userKey:', err));
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
    creationPromise
      .catch(() => {})
      .finally(() => this.pendingClientCreations.delete(user.id));
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
      const bpId = this.resolveBotpressId(dbConversation.id);
      try {
        await ctx.client.getConversation({ id: bpId });
        ctx.conversationId = dbConversation.id;
        return dbConversation;
      } catch {
        // Botpress lost this conversation — create a fresh one and map it
        this.logger.warn(
          `Conversation ${dbConversation.id} not found in Botpress, creating replacement`,
        );
        const { conversation: fresh } = await ctx.client.createConversation({});
        this.renewedConversations.set(dbConversation.id, fresh.id);
        ctx.conversationId = dbConversation.id;
        return dbConversation;
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

  async startNew(user: User): Promise<AiConversation> {
    try {
      const ctx = await this.getClient(user);
      const { conversation } = await ctx.client.createConversation({});
      ctx.conversationId = conversation.id;

      return this.prismaService.aiConversation.create({
        data: { userId: user.id, id: conversation.id },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create new conversation for user ${user.id}:`,
        err,
      );
      throw new ServiceUnavailableException(
        'Cannot start a new AI conversation at the time!',
      );
    }
  }

  async resumeConversation(
    user: User,
    conversationId: string,
  ): Promise<AiConversation> {
    const existing = await this.prismaService.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!existing) {
      throw new NotFoundException('Conversation not found.');
    }

    let ctx: IUserContext;
    try {
      ctx = await this.getClient(user);
    } catch (err) {
      this.logger.error(`Failed to connect to AI service for user ${user.id}:`, err);
      throw new ServiceUnavailableException('AI service is temporarily unavailable.');
    }

    const bpId = this.resolveBotpressId(conversationId);
    try {
      await ctx.client.getConversation({ id: bpId });
      ctx.conversationId = conversationId;
      return existing;
    } catch {
      // Botpress lost this conversation — create a replacement and map it
      this.logger.warn(
        `Botpress conversation ${conversationId} expired; creating replacement`,
      );
      const { conversation: fresh } = await ctx.client.createConversation({});
      this.renewedConversations.set(conversationId, fresh.id);
      ctx.conversationId = conversationId;
      return existing;
    }
  }

  async listConversations(
    userId: string,
    skip = 0,
    take = 20,
  ): Promise<{ data: AiConversation[]; total: number; skip: number; take: number }> {
    const cappedTake = Math.min(take, 100);
    const [data, total] = await Promise.all([
      this.prismaService.aiConversation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          soap: {
            select: {
              id: true,
              suggestedSpecialty: true,
              triageLevel: true,
              createdAt: true,
            },
          },
        },
        skip,
        take: cappedTake,
      }),
      this.prismaService.aiConversation.count({ where: { userId } }),
    ]);

    return { data, total, skip, take: cappedTake };
  }

  async renameConversation(
    userId: string,
    conversationId: string,
    topic: string,
  ): Promise<AiConversation> {
    const conversation = await this.prismaService.aiConversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    return this.prismaService.aiConversation.update({
      where: { id: conversationId },
      data: { topic },
    });
  }

  async startGuest(): Promise<{ id: string; guest: true }> {
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Botpress chat is not configured.');
    }
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
    let ctx: IUserContext;
    try {
      ctx = await this.getClient(user);
    } catch (err) {
      this.logger.error(`Failed to connect to AI service for send:`, err);
      throw new ServiceUnavailableException('AI service is temporarily unavailable.');
    }
    const bpId = this.resolveBotpressId(conversationId);

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await ctx.client.createMessage({
          conversationId: bpId,
          payload: { type: 'text', text },
        });
        return;
      } catch (error: any) {
        const isTransient =
          error?.error?.code === 'ECONNRESET' ||
          error?.error?.code === 'ETIMEDOUT' ||
          error?.error?.code === 'ENOTFOUND' ||
          error?.error?.code === 'EAI_AGAIN' ||
          error?.code === 500;
        if (isTransient && attempt < maxRetries) {
          this.logger.warn(`Transient error sending message (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        this.logger.error(
          `Failed to send message to conversation ${conversationId}:`,
          error,
        );
        throw error;
      }
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
    let ctx: IUserContext;
    try {
      ctx = await this.getClient(user);
    } catch (err) {
      this.logger.error(`Failed to connect to AI service for listen:`, err);
      throw new ServiceUnavailableException('AI service is temporarily unavailable.');
    }
    const bpId = this.resolveBotpressId(conversationId);

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
        id: bpId,
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

  async pollForNewMessages(
    user: User,
    conversationId: string,
    dateOffset?: Date,
  ): Promise<any[]> {
    let ctx: IUserContext;
    try {
      ctx = await this.getClient(user);
    } catch (err) {
      this.logger.error(`Failed to connect to AI service for poll:`, err);
      return [];
    }
    const bpId = this.resolveBotpressId(conversationId);
    return this.pollFromClient(ctx.client, bpId, dateOffset);
  }

  async getConversationHistory(
    user: User,
    conversationId: string,
  ): Promise<
    {
      id: string;
      role: string;
      text: string;
      createdAt: string;
      choices?: { label: string; value: string }[];
    }[]
  > {
    const convo = await this.prismaService.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!convo) return [];

    try {
      const ctx = await this.getClient(user);
      const bpId = this.resolveBotpressId(conversationId);
      const allMessages: any[] = [];
      let nextToken: string | undefined;
      do {
        const page = await ctx.client.listMessages({ conversationId: bpId, ...(nextToken ? { nextToken } : {}) });
        allMessages.push(...page.messages);
        nextToken = (page as any).meta?.nextToken;
      } while (nextToken);

      const sorted = allMessages
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((msg) => {
          const text = BotpressService.extractPayloadText(msg.payload) ?? '';
          const choices = BotpressService.extractPayloadChoices(msg.payload);
          return {
            id: msg.id,
            role: msg.userId === ctx.client.user.id ? 'user' : 'bot',
            text,
            createdAt: msg.createdAt,
            ...(choices ? { choices } : {}),
          };
        });

      // Botpress splits text + quick-reply options into separate messages.
      // Merge consecutive bot messages so they appear as one.
      const merged: typeof sorted = [];
      for (const msg of sorted) {
        const prev = merged[merged.length - 1];
        if (prev && prev.role === 'bot' && msg.role === 'bot') {
          const oneHasChoices = (!prev.choices && msg.choices) || (prev.choices && !msg.choices);
          if (oneHasChoices) {
            if (msg.choices) prev.choices = msg.choices;
            if (msg.text && msg.text.length > prev.text.length) prev.text = msg.text;
            continue;
          }
        }
        merged.push(msg);
      }

      return merged.filter((m) => m.text);
    } catch {
      return [];
    }
  }

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

  static extractPayloadText(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const p = payload as Record<string, unknown>;
    if (typeof p.text === 'string') return p.text;
    if (typeof p.markdown === 'string') return p.markdown;
    if (typeof p.title === 'string') return p.title;
    return undefined;
  }

  static extractPayloadChoices(
    payload: unknown,
  ): { label: string; value: string }[] | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const p = payload as Record<string, unknown>;
    if (!Array.isArray(p.options) || p.options.length === 0) return undefined;
    const choices = (p.options as any[])
      .filter(
        (o) => typeof o?.label === 'string' && typeof o?.value === 'string',
      )
      .map((o) => ({ label: o.label as string, value: o.value as string }));
    return choices.length > 0 ? choices : undefined;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  private pruneGuestContexts(): void {
    const now = Date.now();
    for (const [conversationId, context] of this.guestContexts.entries()) {
      if (context.expiresAt <= now) {
        this.guestContexts.delete(conversationId);
      }
    }
  }
}
