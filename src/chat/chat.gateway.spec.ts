import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { WsException } from '@nestjs/websockets';
import { MessageTypeEnum } from '@prisma/client';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: Record<string, jest.Mock>;
  let notificationService: Record<string, jest.Mock>;

  const mockUser = {
    id: 'user-1',
    firstname: 'John',
    lastname: 'Doe',
    isActive: true,
  };

  const mockUser2 = {
    id: 'user-2',
    firstname: 'Jane',
    lastname: 'Smith',
    isActive: true,
  };

  const createMockSocket = (user: any = mockUser) => ({
    data: { user },
    id: 'socket-1',
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
    handshake: { headers: {} },
  });

  const createMockServer = () => {
    const toEmit = jest.fn();
    const fetchSockets = jest.fn().mockResolvedValue([]);
    return {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit, fetchSockets }),
      in: jest.fn().mockReturnValue({
        socketsJoin: jest.fn(),
        fetchSockets,
      }),
      _toEmit: toEmit,
    };
  };

  beforeEach(async () => {
    chatService = {
      isOnline: jest.fn().mockReturnValue(false),
      setOnline: jest.fn(),
      setOffline: jest.fn(),
      getSocketIds: jest.fn().mockReturnValue([]),
      getUserChatIds: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn(),
      serializeMessage: jest.fn((msg) => ({
        ...msg,
        id: String(msg.id),
      })),
      assertChatParticipant: jest.fn().mockResolvedValue(undefined),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      editMessage: jest.fn(),
      deleteMessage: jest.fn(),
      getChatParticipantUserIds: jest.fn().mockResolvedValue([]),
    };

    notificationService = {
      onNewChatMessage: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: chatService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('sid'),
            getOrThrow: jest.fn().mockReturnValue('test-secret'),
          },
        },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    gateway.server = createMockServer() as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── handleConnection ───

  describe('handleConnection', () => {
    it('should set user online, join rooms, and broadcast online status', async () => {
      const client = createMockSocket();
      chatService.getUserChatIds.mockResolvedValue(['chat-1', 'chat-2']);
      chatService.isOnline.mockReturnValue(false);

      await gateway.handleConnection(client as any);

      expect(chatService.setOnline).toHaveBeenCalledWith('user-1', 'socket-1');
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.join).toHaveBeenCalledWith('chat:chat-1');
      expect(client.join).toHaveBeenCalledWith('chat:chat-2');
      expect(gateway.server.emit).toHaveBeenCalledWith('user:online', {
        userId: 'user-1',
        isOnline: true,
      });
    });

    it('should not broadcast online if user was already online', async () => {
      const client = createMockSocket();
      chatService.isOnline.mockReturnValue(true);

      await gateway.handleConnection(client as any);

      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it('should disconnect client with no user data', async () => {
      const client = createMockSocket(null);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(chatService.setOnline).not.toHaveBeenCalled();
    });
  });

  // ─── handleDisconnect ───

  describe('handleDisconnect', () => {
    it('should set user offline and broadcast when no sockets remain', () => {
      const client = createMockSocket();
      chatService.isOnline.mockReturnValue(false);

      gateway.handleDisconnect(client as any);

      expect(chatService.setOffline).toHaveBeenCalledWith('user-1', 'socket-1');
      expect(gateway.server.emit).toHaveBeenCalledWith('user:online', {
        userId: 'user-1',
        isOnline: false,
      });
    });

    it('should not broadcast offline if user has remaining sockets', () => {
      const client = createMockSocket();
      chatService.isOnline.mockReturnValue(true);

      gateway.handleDisconnect(client as any);

      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it('should do nothing when client has no user', () => {
      const client = createMockSocket(null);

      gateway.handleDisconnect(client as any);

      expect(chatService.setOffline).not.toHaveBeenCalled();
    });
  });

  // ─── handleMessage ───

  describe('handleMessage (chat:message)', () => {
    it('should save message and broadcast to chat room', async () => {
      const client = createMockSocket();
      const message = {
        id: BigInt(1),
        chatId: 'chat-1',
        content: 'Hello',
        type: MessageTypeEnum.TEXT,
        senderId: 'user-1',
      };
      chatService.sendMessage.mockResolvedValue(message);
      chatService.getChatParticipantUserIds.mockResolvedValue([
        'user-1',
        'user-2',
      ]);

      await gateway.handleMessage(client as any, {
        chatId: 'chat-1',
        content: 'Hello',
      });

      expect(chatService.sendMessage).toHaveBeenCalledWith('chat-1', 'user-1', {
        content: 'Hello',
        type: MessageTypeEnum.TEXT,
        fileUrl: undefined,
        repliedToId: undefined,
      });
      expect(gateway.server.to).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when chatId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleMessage(client as any, {
          chatId: '',
          content: 'Hello',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when content is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleMessage(client as any, {
          chatId: 'chat-1',
          content: '',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when user is missing', async () => {
      const client = createMockSocket(null);

      await expect(
        gateway.handleMessage(client as any, {
          chatId: 'chat-1',
          content: 'Hello',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should emit chat:error when service throws', async () => {
      const client = createMockSocket();
      chatService.sendMessage.mockRejectedValue(new Error('DB error'));

      await gateway.handleMessage(client as any, {
        chatId: 'chat-1',
        content: 'Hello',
      });

      expect(client.emit).toHaveBeenCalledWith('chat:error', {
        event: 'chat:message',
        message: 'DB error',
      });
    });
  });

  // ─── handleTyping ───

  describe('handleTyping (chat:typing)', () => {
    it('should broadcast typing to room (excluding sender)', async () => {
      const client = createMockSocket();

      await gateway.handleTyping(client as any, {
        chatId: 'chat-1',
        isTyping: true,
      });

      expect(chatService.assertChatParticipant).toHaveBeenCalledWith(
        'chat-1',
        'user-1',
      );
      expect(client.to).toHaveBeenCalledWith('chat:chat-1');
      expect(client.to('chat:chat-1').emit).toHaveBeenCalledWith(
        'chat:typing',
        {
          userId: 'user-1',
          firstname: 'John',
          isTyping: true,
        },
      );
    });

    it('should throw WsException when chatId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleTyping(client as any, {
          chatId: '',
          isTyping: true,
        }),
      ).rejects.toThrow(WsException);
    });
  });

  // ─── handleRead ───

  describe('handleRead (chat:read)', () => {
    it('should mark messages as read and notify room', async () => {
      const client = createMockSocket();

      await gateway.handleRead(client as any, {
        chatId: 'chat-1',
        messageId: '100',
      });

      expect(chatService.markAsRead).toHaveBeenCalledWith(
        'chat-1',
        'user-1',
        BigInt(100),
      );
      expect(client.to).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when chatId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleRead(client as any, { chatId: '', messageId: '1' }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when messageId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleRead(client as any, { chatId: 'c1', messageId: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should emit chat:error when markAsRead fails', async () => {
      const client = createMockSocket();
      chatService.markAsRead.mockRejectedValue(new Error('not found'));

      await gateway.handleRead(client as any, {
        chatId: 'chat-1',
        messageId: '1',
      });

      expect(client.emit).toHaveBeenCalledWith('chat:error', {
        event: 'chat:read',
        message: 'not found',
      });
    });
  });

  // ─── handleEdit ───

  describe('handleEdit (chat:edit)', () => {
    it('should edit message and broadcast chat:edited', async () => {
      const client = createMockSocket();
      const edited = {
        id: BigInt(1),
        chatId: 'chat-1',
        content: 'edited text',
      };
      chatService.editMessage.mockResolvedValue(edited);

      await gateway.handleEdit(client as any, {
        messageId: '1',
        content: 'edited text',
      });

      expect(chatService.editMessage).toHaveBeenCalledWith(
        BigInt(1),
        'user-1',
        'edited text',
      );
      expect(gateway.server.to).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when messageId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleEdit(client as any, { messageId: '', content: 'hi' }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when content is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleEdit(client as any, { messageId: '1', content: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should emit chat:error on service failure', async () => {
      const client = createMockSocket();
      chatService.editMessage.mockRejectedValue(new Error('forbidden'));

      await gateway.handleEdit(client as any, {
        messageId: '1',
        content: 'text',
      });

      expect(client.emit).toHaveBeenCalledWith('chat:error', {
        event: 'chat:edit',
        message: 'forbidden',
      });
    });
  });

  // ─── handleDelete ───

  describe('handleDelete (chat:delete)', () => {
    it('should delete message and broadcast chat:deleted', async () => {
      const client = createMockSocket();
      const deleted = { id: BigInt(1), chatId: 'chat-1', deletedAt: new Date() };
      chatService.deleteMessage.mockResolvedValue(deleted);

      await gateway.handleDelete(client as any, { messageId: '1' });

      expect(chatService.deleteMessage).toHaveBeenCalledWith(
        BigInt(1),
        'user-1',
      );
      expect(gateway.server.to).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when messageId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleDelete(client as any, { messageId: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should emit chat:error on service failure', async () => {
      const client = createMockSocket();
      chatService.deleteMessage.mockRejectedValue(new Error('not owner'));

      await gateway.handleDelete(client as any, { messageId: '1' });

      expect(client.emit).toHaveBeenCalledWith('chat:error', {
        event: 'chat:delete',
        message: 'not owner',
      });
    });
  });

  // ─── handleJoin ───

  describe('handleJoin (chat:join)', () => {
    it('should join the chat room after verifying participation', async () => {
      const client = createMockSocket();

      await gateway.handleJoin(client as any, { chatId: 'chat-1' });

      expect(chatService.assertChatParticipant).toHaveBeenCalledWith(
        'chat-1',
        'user-1',
      );
      expect(client.join).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when chatId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleJoin(client as any, { chatId: '' }),
      ).rejects.toThrow(WsException);
    });
  });

  // ─── handleLeave ───

  describe('handleLeave (chat:leave)', () => {
    it('should leave the chat room', () => {
      const client = createMockSocket();

      gateway.handleLeave(client as any, { chatId: 'chat-1' });

      expect(client.leave).toHaveBeenCalledWith('chat:chat-1');
    });

    it('should throw WsException when chatId is missing', () => {
      const client = createMockSocket();

      expect(() =>
        gateway.handleLeave(client as any, { chatId: '' }),
      ).toThrow(WsException);
    });
  });

  // ─── addUserToRoom ───

  describe('addUserToRoom', () => {
    it('should join all user sockets to the chat room', () => {
      chatService.getSocketIds.mockReturnValue(['s1', 's2']);

      gateway.addUserToRoom('user-1', 'chat-1');

      expect(gateway.server.in).toHaveBeenCalledWith('s1');
      expect(gateway.server.in).toHaveBeenCalledWith('s2');
    });
  });

  // ─── onModuleDestroy ───

  describe('onModuleDestroy', () => {
    it('should destroy rate limiters without throwing', () => {
      expect(() => gateway.onModuleDestroy()).not.toThrow();
    });
  });
});
