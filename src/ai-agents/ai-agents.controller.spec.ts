import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AiAgentsController } from './ai-agents.controller';
import { BotpressService } from './botpress.service';
import { SoapService } from '../soap/soap.service';
import {
  randomUuid,
  buildUser,
  buildAiConversation,
} from '../../test/helpers/test-data.factory';

describe('AiAgentsController', () => {
  let controller: AiAgentsController;
  let botpressService: Record<string, jest.Mock>;
  let soapService: Record<string, jest.Mock>;

  beforeEach(async () => {
    botpressService = {
      start: jest.fn(),
      startNew: jest.fn(),
      startGuest: jest.fn(),
      send: jest.fn(),
      sendGuest: jest.fn(),
      getConversation: jest.fn(),
      resumeConversation: jest.fn(),
      listConversations: jest.fn(),
      pollForNewMessages: jest.fn(),
      pollGuestMessages: jest.fn(),
      getConversationHistory: jest.fn(),
      listen: jest.fn(),
      releaseListener: jest.fn(),
    };

    soapService = {
      containsSoapTag: jest.fn().mockReturnValue(false),
      detectAndUpsert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiAgentsController],
      providers: [
        { provide: BotpressService, useValue: botpressService },
        { provide: SoapService, useValue: soapService },
      ],
    }).compile();

    controller = module.get<AiAgentsController>(AiAgentsController);
  });

  // ─── POST /ai-agents/start ───

  describe('start', () => {
    it('should start conversation for authenticated user', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });
      botpressService.start.mockResolvedValue(convo);

      const result = await controller.start(user as any);

      expect(result).toEqual(convo);
      expect(botpressService.start).toHaveBeenCalledWith(user);
    });

    it('should start guest conversation when no user', async () => {
      const guestResult = { id: randomUuid(), guest: true };
      botpressService.startGuest.mockResolvedValue(guestResult);

      const result = await controller.start(null);

      expect(result).toEqual(guestResult);
      expect(botpressService.startGuest).toHaveBeenCalled();
      expect(botpressService.start).not.toHaveBeenCalled();
    });
  });

  // ─── POST /ai-agents/message ───

  describe('send', () => {
    it('should send message for authenticated user', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const text = `msg-${randomUuid()}`;
      const convo = buildAiConversation({ id: convoId, userId: user.id });

      botpressService.getConversation.mockResolvedValue(convo);
      botpressService.send.mockResolvedValue(undefined);

      await controller.send(user as any, {
        conversationId: convoId,
        text,
      });

      expect(botpressService.send).toHaveBeenCalledWith(user, convoId, text);
    });

    it('should send guest message when no user', async () => {
      const convoId = randomUuid();
      const text = `msg-${randomUuid()}`;

      await controller.send(null, { conversationId: convoId, text });

      expect(botpressService.sendGuest).toHaveBeenCalledWith(convoId, text);
      expect(botpressService.send).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for guest without conversationId', async () => {
      await expect(
        controller.send(null, { text: 'hello' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── GET /ai-agents/messages/:conversationId ───

  describe('pollMessages', () => {
    it('should return bot messages', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const messages = [
        { id: randomUuid(), payload: { text: 'hello' }, userId: 'bot' },
      ];

      botpressService.pollForNewMessages.mockResolvedValue(messages);

      const result = await controller.pollMessages(user as any, convoId);

      expect(result).toEqual(messages);
      expect(botpressService.pollForNewMessages).toHaveBeenCalledWith(
        user,
        convoId,
        undefined,
      );
    });

    it('should parse dateOffset query parameter', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const dateStr = '2026-01-15T10:00:00Z';

      botpressService.pollForNewMessages.mockResolvedValue([]);

      await controller.pollMessages(user as any, convoId, dateStr);

      expect(botpressService.pollForNewMessages).toHaveBeenCalledWith(
        user,
        convoId,
        new Date(dateStr),
      );
    });

    it('should detect and upsert SOAP when message contains tag', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const soapText = '***SOAP***\nSubjective: pain\n***SOAP***';
      const messages = [
        { id: randomUuid(), payload: { text: soapText }, userId: 'bot' },
      ];

      botpressService.pollForNewMessages.mockResolvedValue(messages);
      soapService.containsSoapTag.mockReturnValue(true);
      soapService.detectAndUpsert.mockResolvedValue({ id: randomUuid() });

      await controller.pollMessages(user as any, convoId);

      expect(soapService.detectAndUpsert).toHaveBeenCalledWith(
        user.id,
        convoId,
        soapText,
      );
    });

    it('should not attempt SOAP detection for non-SOAP messages', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const messages = [
        { id: randomUuid(), payload: { text: 'just a normal message' }, userId: 'bot' },
      ];

      botpressService.pollForNewMessages.mockResolvedValue(messages);
      soapService.containsSoapTag.mockReturnValue(false);

      await controller.pollMessages(user as any, convoId);

      expect(soapService.detectAndUpsert).not.toHaveBeenCalled();
    });

    it('should not throw if SOAP upsert fails', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const soapText = '***SOAP***\nSubjective: test\n***SOAP***';
      const messages = [
        { id: randomUuid(), payload: { text: soapText }, userId: 'bot' },
      ];

      botpressService.pollForNewMessages.mockResolvedValue(messages);
      soapService.containsSoapTag.mockReturnValue(true);
      soapService.detectAndUpsert.mockRejectedValue(new Error('DB error'));

      const result = await controller.pollMessages(user as any, convoId);

      expect(result).toEqual(messages);
    });
  });

  // ─── GET /ai-agents/guest/messages/:conversationId ───

  describe('pollGuestMessages', () => {
    it('should poll guest messages', async () => {
      const convoId = randomUuid();
      const messages = [{ id: randomUuid(), payload: { text: 'hello' } }];
      botpressService.pollGuestMessages.mockResolvedValue(messages);

      const result = await controller.pollGuestMessages(convoId);

      expect(result).toEqual(messages);
      expect(botpressService.pollGuestMessages).toHaveBeenCalledWith(
        convoId,
        undefined,
      );
    });

    it('should pass dateOffset to service', async () => {
      const convoId = randomUuid();
      const dateStr = '2026-06-01T00:00:00Z';
      botpressService.pollGuestMessages.mockResolvedValue([]);

      await controller.pollGuestMessages(convoId, dateStr);

      expect(botpressService.pollGuestMessages).toHaveBeenCalledWith(
        convoId,
        new Date(dateStr),
      );
    });
  });

  // ─── GET /ai-agents/history/:conversationId ───

  describe('getConversationHistory', () => {
    it('should return conversation history', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const history = [
        { id: randomUuid(), role: 'user', text: 'hello', createdAt: new Date().toISOString() },
        { id: randomUuid(), role: 'bot', text: 'hi there', createdAt: new Date().toISOString() },
      ];

      botpressService.getConversationHistory.mockResolvedValue(history);

      const result = await controller.getConversationHistory(
        user as any,
        convoId,
      );

      expect(result).toEqual(history);
      expect(botpressService.getConversationHistory).toHaveBeenCalledWith(
        user,
        convoId,
      );
    });
  });

  // ─── GET /ai-agents/conversations ───

  describe('listConversations', () => {
    it('should list conversations with default pagination', async () => {
      const user = buildUser();
      const expected = { data: [], total: 0, skip: 0, take: 20 };
      botpressService.listConversations.mockResolvedValue(expected);

      const result = await controller.listConversations(user as any, 0, 20);

      expect(result).toEqual(expected);
      expect(botpressService.listConversations).toHaveBeenCalledWith(
        user.id,
        0,
        20,
      );
    });

    it('should pass custom pagination params', async () => {
      const user = buildUser();
      const expected = { data: [], total: 50, skip: 10, take: 5 };
      botpressService.listConversations.mockResolvedValue(expected);

      const result = await controller.listConversations(user as any, 10, 5);

      expect(result).toEqual(expected);
      expect(botpressService.listConversations).toHaveBeenCalledWith(
        user.id,
        10,
        5,
      );
    });
  });

  // ─── POST /ai-agents/start/new ───

  describe('startNew', () => {
    it('should start a new conversation', async () => {
      const user = buildUser();
      const convo = buildAiConversation({ userId: user.id });
      botpressService.startNew.mockResolvedValue(convo);

      const result = await controller.startNew(user as any);

      expect(result).toEqual(convo);
      expect(botpressService.startNew).toHaveBeenCalledWith(user);
    });
  });

  // ─── POST /ai-agents/start/:conversationId ───

  describe('resumeConversation', () => {
    it('should resume a specific conversation', async () => {
      const user = buildUser();
      const convoId = randomUuid();
      const convo = buildAiConversation({ id: convoId, userId: user.id });
      botpressService.resumeConversation.mockResolvedValue(convo);

      const result = await controller.resumeConversation(user as any, convoId);

      expect(result).toEqual(convo);
      expect(botpressService.resumeConversation).toHaveBeenCalledWith(
        user,
        convoId,
      );
    });
  });
});
