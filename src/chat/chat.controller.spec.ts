import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MessageTypeEnum } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: { sendMessage: jest.Mock; serializeMessage: jest.Mock };
  let chatGateway: { announceNewMessage: jest.Mock };

  const buildUser = () =>
    ({
      id: randomUUID(),
      firstname: `F${randomUUID().slice(0, 6)}`,
      lastname: `L${randomUUID().slice(0, 6)}`,
    }) as any;

  beforeEach(async () => {
    chatService = {
      sendMessage: jest.fn(),
      serializeMessage: jest.fn((m) => ({ ...m, id: String(m.id) })),
    };
    chatGateway = { announceNewMessage: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: ChatGateway, useValue: chatGateway },
      ],
    }).compile();

    controller = module.get(ChatController);
  });

  describe('sendMessage (HTTP fallback)', () => {
    it('should save, announce like a WebSocket send, and return the serialized message', async () => {
      const user = buildUser();
      const chatId = randomUUID();
      const dto = { content: `Hello ${randomUUID()}` };
      const message = {
        id: BigInt(Math.floor(Math.random() * 1e6) + 1),
        chatId,
        senderId: user.id,
        content: dto.content,
        type: MessageTypeEnum.TEXT,
      };
      chatService.sendMessage.mockResolvedValue(message);

      const result = await controller.sendMessage(user, chatId, dto);

      expect(chatService.sendMessage).toHaveBeenCalledWith(chatId, user.id, dto);
      expect(chatGateway.announceNewMessage).toHaveBeenCalledWith(
        message,
        `${user.firstname} ${user.lastname}`,
      );
      expect(result).toEqual({ ...message, id: String(message.id) });
    });

    it('should announce nothing when the message is refused', async () => {
      chatService.sendMessage.mockRejectedValue(
        new ForbiddenException('You are not a participant in this chat'),
      );

      await expect(
        controller.sendMessage(buildUser(), randomUUID(), { content: 'Hi' }),
      ).rejects.toThrow(ForbiddenException);
      expect(chatGateway.announceNewMessage).not.toHaveBeenCalled();
    });
  });
});
