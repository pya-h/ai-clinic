import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BotpressService } from './botpress.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  randomUuid,
  buildUser,
  buildAiConversation,
} from '../../test/helpers/test-data.factory';

// The mock client object — created inside jest.mock so hoisting works,
// then exported via __esModule so tests can reference it.
jest.mock('@botpress/chat', () => {
  const client: Record<string, any> = {
    user: { id: 'bp-user-id', key: 'bp-user-key' },
    createMessage: jest.fn().mockResolvedValue({}),
    getConversation: jest.fn().mockResolvedValue({ id: 'any' }),
    createConversation: jest.fn(),
    listMessages: jest.fn().mockResolvedValue({ messages: [] }),
    listenConversation: jest.fn(),
  };

  return {
    __esModule: true,
    _mockClient: client,
    Client: class MockClient {
      webhookId: string;
      constructor(opts?: any) {
        this.webhookId = opts?.webhookId;
      }
      static connect = jest.fn().mockResolvedValue(client);
      getUser = jest.fn().mockResolvedValue({
        user: { id: 'bp-user-id', key: 'bp-user-key' },
      });
    },
    AuthenticatedClient: jest.fn().mockImplementation(() => client),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _mockClient: bpClient } = require('@botpress/chat');

describe('BotpressService', () => {
  let service: BotpressService;
  let prisma: Record<string, any>;
  let cache: Record<string, any>;

  const webhookId = `wh-${randomUuid()}`;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Re-apply default resolved values after clearAllMocks
    bpClient.createMessage.mockResolvedValue({});
    bpClient.getConversation.mockResolvedValue({ id: 'any' });
    bpClient.listMessages.mockResolvedValue({ messages: [] });

    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      aiConversation: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
    };

    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockImplementation((_g, _k, value) =>
        Promise.resolve(value),
      ),
      registerDelEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotpressService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'botpress.webhookId') return webhookId;
              if (key === 'botpress.deliveryMode') return 'sse';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BotpressService>(BotpressService);
  });

  describe('constructor', () => {
    it('should throw ServiceUnavailableException when webhookId is missing', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            BotpressService,
            { provide: PrismaService, useValue: prisma },
            { provide: CacheService, useValue: cache },
            {
              provide: ConfigService,
              useValue: { get: jest.fn().mockReturnValue(undefined) },
            },
          ],
        }).compile(),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should default deliveryMode to sse when not configured', () => {
      expect(service.deliveryMode).toBe('sse');
    });
  });

  describe('extractPayloadText (static)', () => {
    it('should extract text from payload', () => {
      expect(BotpressService.extractPayloadText({ text: 'hello' })).toBe('hello');
    });

    it('should extract markdown when text is missing', () => {
      expect(BotpressService.extractPayloadText({ markdown: '# hi' })).toBe('# hi');
    });

    it('should extract title as last fallback', () => {
      expect(BotpressService.extractPayloadText({ title: 'Title' })).toBe('Title');
    });

    it('should prefer text over markdown and title', () => {
      expect(
        BotpressService.extractPayloadText({ text: 'text', markdown: 'md', title: 'title' }),
      ).toBe('text');
    });

    it('should return undefined for null payload', () => {
      expect(BotpressService.extractPayloadText(null)).toBeUndefined();
    });

    it('should return undefined for non-object payload', () => {
      expect(BotpressService.extractPayloadText('string')).toBeUndefined();
    });

    it('should return undefined for empty object', () => {
      expect(BotpressService.extractPayloadText({})).toBeUndefined();
    });

    it('should return undefined for numeric text value', () => {
      expect(BotpressService.extractPayloadText({ text: 42 })).toBeUndefined();
    });
  });

  describe('start', () => {
    it('should resume existing conversation from cache', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });

      cache.get.mockResolvedValue({ client: bpClient, conversationId: convo.id });
      prisma.aiConversation.findUnique.mockResolvedValue(convo);

      const result = await service.start(user as any);
      expect(result).toEqual(convo);
    });

    it('should resume latest DB conversation when cache has no conversationId', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });

      cache.get.mockResolvedValue({ client: bpClient });
      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      bpClient.getConversation.mockResolvedValue({ id: convo.id });

      const result = await service.start(user as any);

      expect(result).toEqual(convo);
      expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should create new conversation when no existing one found', async () => {
      const user = buildUser();
      const newBpId = randomUuid();
      const newConvo = buildAiConversation({ id: newBpId, userId: user.id });

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      prisma.aiConversation.findFirst.mockResolvedValue(null);
      bpClient.createConversation.mockResolvedValue({ conversation: { id: newBpId } });
      prisma.aiConversation.create.mockResolvedValue(newConvo);

      const result = await service.start(user as any);

      expect(result).toEqual(newConvo);
      expect(prisma.aiConversation.create).toHaveBeenCalledWith({
        data: { userId: user.id, id: newBpId },
      });
    });

    it('should throw ServiceUnavailableException on failure', async () => {
      const user = buildUser();
      cache.get.mockRejectedValue(new Error('cache down'));

      await expect(service.start(user as any)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('startNew', () => {
    it('should create a brand-new conversation', async () => {
      const user = buildUser();
      const newBpId = randomUuid();
      const newConvo = buildAiConversation({ id: newBpId, userId: user.id });

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.createConversation.mockResolvedValue({ conversation: { id: newBpId } });
      prisma.aiConversation.create.mockResolvedValue(newConvo);

      const result = await service.startNew(user as any);

      expect(result).toEqual(newConvo);
      expect(bpClient.createConversation).toHaveBeenCalledWith({});
    });

    it('should throw ServiceUnavailableException on Botpress error', async () => {
      const user = buildUser();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.createConversation.mockRejectedValue(new Error('Botpress down'));

      await expect(service.startNew(user as any)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('resumeConversation', () => {
    it('should resume an owned conversation', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.getConversation.mockResolvedValue({ id: convo.id });

      const result = await service.resumeConversation(user as any, convo.id);
      expect(result).toEqual(convo);
    });

    it('should throw NotFoundException for non-existent conversation', async () => {
      const user = buildUser();
      prisma.aiConversation.findFirst.mockResolvedValue(null);

      await expect(
        service.resumeConversation(user as any, randomUuid()),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException for another user's conversation", async () => {
      const user = buildUser();
      const otherId = randomUuid();
      prisma.aiConversation.findFirst.mockResolvedValue(null);

      await expect(
        service.resumeConversation(user as any, otherId),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith({
        where: { id: otherId, userId: user.id },
      });
    });

    it('should create replacement when Botpress lost the conversation', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });
      const replacementBpId = randomUuid();

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.getConversation.mockRejectedValue(new Error('Not found'));
      bpClient.createConversation.mockResolvedValue({
        conversation: { id: replacementBpId },
      });

      const result = await service.resumeConversation(user as any, convo.id);

      expect(result).toEqual(convo);
      expect(bpClient.createConversation).toHaveBeenCalled();
    });

    it('should throw ServiceUnavailableException when client fails', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockRejectedValue(new Error('connection failed'));

      await expect(
        service.resumeConversation(user as any, convo.id),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('listConversations', () => {
    it('should return paginated conversations with SOAP data', async () => {
      const userId = randomUuid();
      const convos = [buildAiConversation({ userId }), buildAiConversation({ userId })];

      prisma.aiConversation.findMany.mockResolvedValue(convos);
      prisma.aiConversation.count.mockResolvedValue(2);

      const result = await service.listConversations(userId, 0, 20);

      expect(result).toEqual({ data: convos, total: 2, skip: 0, take: 20 });
      expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          include: {
            soap: {
              select: { id: true, suggestedSpecialty: true, triageLevel: true, createdAt: true },
            },
          },
        }),
      );
    });

    it('should return empty list for user with no conversations', async () => {
      const userId = randomUuid();
      prisma.aiConversation.findMany.mockResolvedValue([]);
      prisma.aiConversation.count.mockResolvedValue(0);

      const result = await service.listConversations(userId);
      expect(result).toEqual({ data: [], total: 0, skip: 0, take: 20 });
    });

    it('should respect custom pagination', async () => {
      const userId = randomUuid();
      prisma.aiConversation.findMany.mockResolvedValue([]);
      prisma.aiConversation.count.mockResolvedValue(50);

      const result = await service.listConversations(userId, 10, 5);

      expect(result.skip).toBe(10);
      expect(result.take).toBe(5);
      expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  describe('send', () => {
    it('should send a message to Botpress', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const text = `test message ${randomUuid()}`;

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      await service.send(user as any, convoId, text);

      expect(bpClient.createMessage).toHaveBeenCalledWith({
        conversationId: convoId,
        payload: { type: 'text', text },
      });
    });

    it('should retry on transient errors', async () => {
      const user = buildUser();
      const convoId = randomUuid();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      bpClient.createMessage
        .mockRejectedValueOnce({ error: { code: 'ECONNRESET' } })
        .mockResolvedValueOnce({});

      await service.send(user as any, convoId, 'hello');
      expect(bpClient.createMessage).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting retries on transient errors', async () => {
      const user = buildUser();
      const convoId = randomUuid();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      const transientErr = { error: { code: 'ETIMEDOUT' } };
      bpClient.createMessage.mockRejectedValue(transientErr);

      await expect(service.send(user as any, convoId, 'hello')).rejects.toEqual(transientErr);
      expect(bpClient.createMessage).toHaveBeenCalledTimes(3);
    });

    it('should throw immediately on non-transient errors', async () => {
      const user = buildUser();
      const convoId = randomUuid();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      const permanentErr = { code: 400, message: 'Bad request' };
      bpClient.createMessage.mockRejectedValue(permanentErr);

      await expect(service.send(user as any, convoId, 'hello')).rejects.toEqual(permanentErr);
      expect(bpClient.createMessage).toHaveBeenCalledTimes(1);
    });

    it('should throw ServiceUnavailableException when client fails', async () => {
      const user = buildUser();
      cache.get.mockRejectedValue(new Error('cache error'));

      await expect(service.send(user as any, randomUuid(), 'hello')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('sendGuest', () => {
    it('should throw NotFoundException for unknown guest conversation', async () => {
      await expect(service.sendGuest(randomUuid(), 'hello')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for empty text', async () => {
      bpClient.createConversation.mockResolvedValue({ conversation: { id: randomUuid() } });
      const guestResult = await service.startGuest();

      await expect(service.sendGuest(guestResult.id, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for null text', async () => {
      bpClient.createConversation.mockResolvedValue({ conversation: { id: randomUuid() } });
      const guestResult = await service.startGuest();

      await expect(service.sendGuest(guestResult.id, null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('startGuest', () => {
    it('should return a guest conversation with guest flag', async () => {
      bpClient.createConversation.mockResolvedValue({ conversation: { id: randomUuid() } });

      const result = await service.startGuest();

      expect(result).toHaveProperty('id');
      expect(result.guest).toBe(true);
    });
  });

  describe('pollForNewMessages', () => {
    it('should return filtered bot messages', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const botMsg = {
        id: randomUuid(),
        userId: 'bot-user',
        createdAt: new Date().toISOString(),
        payload: { text: 'bot reply' },
      };
      const userMsg = {
        id: randomUuid(),
        userId: bpClient.user.id,
        createdAt: new Date().toISOString(),
        payload: { text: 'user msg' },
      };

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listMessages.mockResolvedValue({ messages: [botMsg, userMsg] });

      const result = await service.pollForNewMessages(user as any, convoId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(botMsg);
    });

    it('should filter by dateOffset when provided', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const oldMsg = {
        id: randomUuid(),
        userId: 'bot-user',
        createdAt: '2020-01-01T00:00:00Z',
        payload: { text: 'old' },
      };
      const newMsg = {
        id: randomUuid(),
        userId: 'bot-user',
        createdAt: new Date().toISOString(),
        payload: { text: 'new' },
      };

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listMessages.mockResolvedValue({ messages: [oldMsg, newMsg] });

      const result = await service.pollForNewMessages(user as any, convoId, new Date('2024-01-01'));

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(newMsg);
    });

    it('should return empty array on Botpress error', async () => {
      const user = buildUser();
      cache.get.mockRejectedValue(new Error('fail'));

      const result = await service.pollForNewMessages(user as any, randomUuid());
      expect(result).toEqual([]);
    });

    it('should paginate through all message pages', async () => {
      const user = buildUser();
      const convoId = randomUuid();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      bpClient.listMessages
        .mockResolvedValueOnce({
          messages: [{ id: '1', userId: 'bot', createdAt: new Date().toISOString() }],
          meta: { nextToken: 'tok' },
        })
        .mockResolvedValueOnce({
          messages: [{ id: '2', userId: 'bot', createdAt: new Date().toISOString() }],
        });

      const result = await service.pollForNewMessages(user as any, convoId);

      expect(result).toHaveLength(2);
      expect(bpClient.listMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe('pollGuestMessages', () => {
    it('should throw NotFoundException for unknown guest conversation', async () => {
      await expect(service.pollGuestMessages(randomUuid())).rejects.toThrow(NotFoundException);
    });
  });

  describe('getConversationHistory', () => {
    it('should return empty array if conversation not owned by user', async () => {
      const user = buildUser();
      prisma.aiConversation.findFirst.mockResolvedValue(null);

      const result = await service.getConversationHistory(user as any, randomUuid());
      expect(result).toEqual([]);
    });

    it('should return sorted messages with role labels', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({ id: convoId, userId: user.id });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      bpClient.listMessages.mockResolvedValue({
        messages: [
          { id: '2', userId: bpClient.user.id, createdAt: '2026-01-01T00:01:00Z', payload: { text: 'user msg' } },
          { id: '1', userId: 'bot-user', createdAt: '2026-01-01T00:00:00Z', payload: { text: 'bot reply' } },
        ],
      });

      const result = await service.getConversationHistory(user as any, convoId);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('bot');
      expect(result[0].text).toBe('bot reply');
      expect(result[1].role).toBe('user');
      expect(result[1].text).toBe('user msg');
    });

    it('should filter out messages with empty text', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({ id: convoId, userId: user.id });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });

      bpClient.listMessages.mockResolvedValue({
        messages: [
          { id: '1', userId: 'bot', createdAt: '2026-01-01T00:00:00Z', payload: {} },
          { id: '2', userId: 'bot', createdAt: '2026-01-01T00:01:00Z', payload: { text: 'real' } },
        ],
      });

      const result = await service.getConversationHistory(user as any, convoId);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('real');
    });

    it('should return empty array on Botpress API error', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({ id: convoId, userId: user.id });

      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listMessages.mockRejectedValue(new Error('API down'));

      const result = await service.getConversationHistory(user as any, convoId);
      expect(result).toEqual([]);
    });
  });

  describe('listen', () => {
    it('should create a new listener for a conversation', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const mockListener = {
        status: 'connected',
        on: jest.fn(),
        off: jest.fn(),
        disconnect: jest.fn(),
        connect: jest.fn(),
      };

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      bpClient.listenConversation.mockResolvedValue(mockListener);

      const result = await service.listen(user as any, convoId);

      expect(result.client).toBeDefined();
      expect(result.listener).toBeDefined();
      expect(result.listener.status).toBe('connected');
    });

    it('should throw ServiceUnavailableException when client fails', async () => {
      const user = buildUser();
      cache.get.mockRejectedValue(new Error('fail'));

      await expect(service.listen(user as any, randomUuid())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('releaseListener', () => {
    it('should disconnect listener and clear from context', async () => {
      const userId = randomUuid();
      const mockListener = { disconnect: jest.fn().mockResolvedValue(undefined) };
      const ctx = { client: bpClient, listener: mockListener };

      cache.get.mockResolvedValue(ctx);

      await service.releaseListener(userId, mockListener as any);

      expect(mockListener.disconnect).toHaveBeenCalled();
      expect(ctx.listener).toBeUndefined();
    });

    it('should handle missing ctx gracefully', async () => {
      const mockListener = { disconnect: jest.fn().mockResolvedValue(undefined) };
      cache.get.mockResolvedValue(null);

      await expect(
        service.releaseListener(randomUuid(), mockListener as any),
      ).resolves.not.toThrow();
    });

    it('should handle missing listener gracefully', async () => {
      cache.get.mockResolvedValue(null);

      await expect(service.releaseListener(randomUuid(), undefined)).resolves.not.toThrow();
    });

    it('should disconnect orphaned listener not in ctx', async () => {
      const userId = randomUuid();
      const orphanListener = { disconnect: jest.fn().mockResolvedValue(undefined) };
      const ctx = { client: bpClient, listener: { other: true } };

      cache.get.mockResolvedValue(ctx);

      await service.releaseListener(userId, orphanListener as any);
      expect(orphanListener.disconnect).toHaveBeenCalled();
    });
  });

  describe('getClient (via start)', () => {
    it('should reuse cached client context', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });

      cache.get.mockResolvedValue({ client: bpClient, conversationId: convo.id });
      prisma.aiConversation.findUnique.mockResolvedValue(convo);

      await service.start(user as any);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should reconnect using saved botpressUserKey', async () => {
      const user = buildUser();
      const savedKey = `bp-key-${randomUuid()}`;
      const convo = buildAiConversation({ userId: user.id });

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: savedKey });
      prisma.aiConversation.findFirst.mockResolvedValue(convo);
      bpClient.getConversation.mockResolvedValue({ id: convo.id });

      await service.start(user as any);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: user.id },
        select: { botpressUserKey: true },
      });
    });

    it('should persist new botpressUserKey when it changes', async () => {
      const user = buildUser();
      const newConvoId = randomUuid();

      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ botpressUserKey: null });
      prisma.aiConversation.findFirst.mockResolvedValue(null);
      bpClient.createConversation.mockResolvedValue({ conversation: { id: newConvoId } });
      prisma.aiConversation.create.mockResolvedValue(
        buildAiConversation({ id: newConvoId, userId: user.id }),
      );
      prisma.user.update.mockResolvedValue({});

      await service.start(user as any);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { botpressUserKey: bpClient.user.key },
      });
    });
  });
});
