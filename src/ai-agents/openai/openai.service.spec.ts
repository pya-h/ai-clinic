import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { OpenAiChatRoles } from './enums/openai-roles.enum';

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

describe('OpenAiService', () => {
  let service: OpenAiService;
  let mockCreate: jest.Mock;

  beforeEach(async () => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'openai.model') return 'gpt-4';
        if (key === 'openai.key') return 'test-api-key';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAiService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<OpenAiService>(OpenAiService);
    mockCreate = (service as any).openaiClient.chat.completions.create;
  });

  afterEach(() => {
    jest.clearAllMocks();
    (service as any).tempHistory.clear();
  });

  describe('getChatHistory', () => {
    it('should return system prompt for new chatId', async () => {
      const history = await service.getChatHistory('chat-1');

      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(OpenAiChatRoles.SYSTEM);
      expect(history[0].content).toContain('medical assistant');
    });

    it('should return same history on subsequent calls', async () => {
      const first = await service.getChatHistory('chat-1');
      const second = await service.getChatHistory('chat-1');

      expect(first).toBe(second);
    });

    it('should evict oldest entry when exceeding MAX_HISTORY_ENTRIES', async () => {
      for (let i = 0; i < 500; i++) {
        await service.getChatHistory(`chat-${i}`);
      }

      expect((service as any).tempHistory.has('chat-0')).toBe(true);

      await service.getChatHistory('chat-500');

      expect((service as any).tempHistory.has('chat-0')).toBe(false);
      expect((service as any).tempHistory.has('chat-500')).toBe(true);
    });
  });

  describe('updateChat', () => {
    it('should append messages to chat history', async () => {
      await service.getChatHistory('chat-1');
      await service.updateChat('chat-1', [
        { role: OpenAiChatRoles.USER, content: 'Hello' },
        { role: OpenAiChatRoles.ASSISTANT, content: 'Hi there' },
      ]);

      const history = await service.getChatHistory('chat-1');
      expect(history).toHaveLength(3);
      expect(history[1].content).toBe('Hello');
      expect(history[2].content).toBe('Hi there');
    });

    it('should trim messages when exceeding MAX_MESSAGES_PER_CHAT', async () => {
      await service.getChatHistory('chat-1');

      const messages = Array.from({ length: 110 }, (_, i) => ({
        role: OpenAiChatRoles.USER,
        content: `Message ${i}`,
      }));
      await service.updateChat('chat-1', messages);

      const history = await service.getChatHistory('chat-1');
      expect(history.length).toBeLessThanOrEqual(100);
      expect(history[0].role).toBe(OpenAiChatRoles.SYSTEM);
    });

    it('should create history if chatId is new', async () => {
      await service.updateChat('new-chat', [
        { role: OpenAiChatRoles.USER, content: 'First message' },
      ]);

      const history = await service.getChatHistory('new-chat');
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].role).toBe(OpenAiChatRoles.SYSTEM);
    });
  });

  describe('runCompletion', () => {
    it('should call OpenAI with chat history and prompt', async () => {
      const mockResult = {
        choices: [{ message: { content: 'AI response' } }],
      };
      mockCreate.mockResolvedValue(mockResult);

      const result = await service.runCompletion('chat-1', 'I have a headache');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: OpenAiChatRoles.SYSTEM }),
            expect.objectContaining({
              role: OpenAiChatRoles.USER,
              content: 'I have a headache',
            }),
          ]),
        }),
      );
      expect(result).toBe(mockResult);
    });

    it('should update chat history after completion', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
      });

      await service.runCompletion('chat-1', 'Hello');

      const history = await service.getChatHistory('chat-1');
      expect(history).toHaveLength(3);
      expect(history[1]).toEqual({
        role: OpenAiChatRoles.USER,
        content: 'Hello',
      });
      expect(history[2]).toEqual({
        role: OpenAiChatRoles.ASSISTANT,
        content: 'Response',
      });
    });

    it('should handle null content in response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await service.runCompletion('chat-1', 'Hello');

      const history = await service.getChatHistory('chat-1');
      expect(history[2].content).toBe('');
    });
  });

  describe('openNewChat', () => {
    it('should return AI response as string', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Welcome! How can I help?' } }],
      });

      const result = await service.openNewChat('user-1', 'I feel sick');

      expect(result).toBe('Welcome! How can I help?');
    });

    it('should return empty string when content is null', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const result = await service.openNewChat('user-1', 'Hello');

      expect(result).toBe('');
    });

    it('should use userId as chatId', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi' } }],
      });

      await service.openNewChat('user-123', 'Hello');

      const history = await service.getChatHistory('user-123');
      expect(history.length).toBeGreaterThan(1);
    });
  });

  describe('disabled mode (missing config)', () => {
    let disabledService: OpenAiService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OpenAiService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();

      disabledService = module.get<OpenAiService>(OpenAiService);
    });

    it('should create service without throwing', () => {
      expect(disabledService).toBeDefined();
    });

    it('should throw ServiceUnavailableException on runCompletion', async () => {
      await expect(
        disabledService.runCompletion('chat-1', 'hello'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on openNewChat', async () => {
      await expect(
        disabledService.openNewChat('user-1', 'hello'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should still allow getChatHistory', async () => {
      const history = await disabledService.getChatHistory('chat-1');
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe(OpenAiChatRoles.SYSTEM);
    });
  });
});
