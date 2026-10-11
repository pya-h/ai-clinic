import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MessageTypeEnum } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: {
    createChat: jest.Mock;
    sendMessage: jest.Mock;
    serializeMessage: jest.Mock;
  };
  let chatGateway: { announceNewMessage: jest.Mock; addUserToRoom: jest.Mock };

  const buildUser = () =>
    ({
      id: randomUUID(),
      firstname: `F${randomUUID().slice(0, 6)}`,
      lastname: `L${randomUUID().slice(0, 6)}`,
    }) as any;

  beforeEach(async () => {
    chatService = {
      createChat: jest.fn(),
      sendMessage: jest.fn(),
      serializeMessage: jest.fn((m) => ({ ...m, id: String(m.id) })),
    };
    chatGateway = { announceNewMessage: jest.fn(), addUserToRoom: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: ChatGateway, useValue: chatGateway },
      ],
    }).compile();

    controller = module.get(ChatController);
  });

  describe('createChat', () => {
    it("should put both participants' open sockets in the chat's room and return the chat", async () => {
      const user = buildUser();
      const other = randomUUID();
      const chat = {
        id: randomUUID(),
        participants: [{ id: user.id }, { id: other }],
      };
      chatService.createChat.mockResolvedValue(chat);
      const dto = { participantId: other };

      await expect(controller.createChat(user, dto)).resolves.toBe(chat);

      expect(chatService.createChat).toHaveBeenCalledWith(user.id, dto);
      expect(chatGateway.addUserToRoom).toHaveBeenCalledTimes(2);
      expect(chatGateway.addUserToRoom).toHaveBeenCalledWith(user.id, chat.id);
      expect(chatGateway.addUserToRoom).toHaveBeenCalledWith(other, chat.id);
    });

    it('should join nobody when the chat is refused', async () => {
      chatService.createChat.mockRejectedValue(
        new ForbiddenException('You cannot start a chat with this user'),
      );

      await expect(
        controller.createChat(buildUser(), { participantId: randomUUID() }),
      ).rejects.toThrow(ForbiddenException);
      expect(chatGateway.addUserToRoom).not.toHaveBeenCalled();
    });
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

      expect(chatService.sendMessage).toHaveBeenCalledWith(
        chatId,
        user.id,
        dto,
      );
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
