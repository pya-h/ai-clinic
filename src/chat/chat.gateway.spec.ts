import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { WsException } from '@nestjs/websockets';
import { MessageTypeEnum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatusCache } from '../auth/user-status';
import { captureHandshake, flushPromises } from '../../test/helpers/ws-handshake.helper';
import { createSessionApp, loginCookie } from '../../test/helpers/session-cookie.helper';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: Record<string, jest.Mock>;
  let notificationService: Record<string, jest.Mock>;
  let prisma: { user: { findFirst: jest.Mock } };

  const activeStatus = (overrides: Record<string, unknown> = {}) => ({
    isActive: true,
    isBanned: false,
    banReason: null,
    role: 'PATIENT',
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  });

  const mockUser = {
    id: 'user-1',
    firstname: 'John',
    lastname: 'Doe',
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
    const disconnectSockets = jest.fn();
    const fetchSockets = jest.fn().mockResolvedValue([]);
    return {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit, fetchSockets }),
      in: jest.fn().mockReturnValue({
        socketsJoin: jest.fn(),
        fetchSockets,
        disconnectSockets,
      }),
      _toEmit: toEmit,
      _disconnectSockets: disconnectSockets,
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

    prisma = { user: { findFirst: jest.fn().mockResolvedValue(activeStatus()) } };
    (UserStatusCache as any).entries.clear();

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
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    gateway.server = createMockServer() as any;
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.clearAllMocks();
  });

  // ─── handleConnection ───

  describe('handleConnection', () => {
    it('should set user online, join rooms, and broadcast online status to chat rooms', async () => {
      const client = createMockSocket();
      chatService.getUserChatIds.mockResolvedValue(['chat-1', 'chat-2']);
      chatService.isOnline.mockReturnValue(false);

      await gateway.handleConnection(client as any);

      expect(chatService.setOnline).toHaveBeenCalledWith('user-1', 'socket-1');
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.join).toHaveBeenCalledWith('chat:chat-1');
      expect(client.join).toHaveBeenCalledWith('chat:chat-2');
      expect(gateway.server.to).toHaveBeenCalledWith(['chat:chat-1', 'chat:chat-2']);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('user:online', {
        userId: 'user-1',
        isOnline: true,
      });
    });

    it('should not broadcast when user has no chats', async () => {
      const client = createMockSocket();
      chatService.getUserChatIds.mockResolvedValue([]);
      chatService.isOnline.mockReturnValue(false);

      await gateway.handleConnection(client as any);

      expect(gateway.server.emit).not.toHaveBeenCalled();
      expect((gateway.server as any)._toEmit).not.toHaveBeenCalledWith('user:online', expect.anything());
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
    it('should set user offline and broadcast to chat rooms when no sockets remain', async () => {
      const client = createMockSocket();
      chatService.isOnline.mockReturnValue(false);
      chatService.getUserChatIds.mockResolvedValue(['chat-1', 'chat-2']);

      await gateway.handleDisconnect(client as any);

      expect(chatService.setOffline).toHaveBeenCalledWith('user-1', 'socket-1');
      expect(gateway.server.to).toHaveBeenCalledWith(['chat:chat-1', 'chat:chat-2']);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('user:online', {
        userId: 'user-1',
        isOnline: false,
      });
    });

    it('should not broadcast offline if user has remaining sockets', async () => {
      const client = createMockSocket();
      chatService.isOnline.mockReturnValue(true);

      await gateway.handleDisconnect(client as any);

      expect(chatService.getUserChatIds).not.toHaveBeenCalled();
    });

    it('should do nothing when client has no user', async () => {
      const client = createMockSocket(null);

      await gateway.handleDisconnect(client as any);

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

    it('should throw WsException when content exceeds 5000 characters', async () => {
      const client = createMockSocket();
      const longContent = 'x'.repeat(5001);

      await expect(
        gateway.handleMessage(client as any, {
          chatId: 'chat-1',
          content: longContent,
        }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException for invalid message type', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleMessage(client as any, {
          chatId: 'chat-1',
          content: 'Hello',
          type: 'INVALID_TYPE' as any,
        }),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when user is banned (status check)', async () => {
      const client = createMockSocket();
      prisma.user.findFirst.mockResolvedValue(activeStatus({ isBanned: true }));

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
      const announce = jest.spyOn(gateway, 'announceNewMessage');

      await gateway.handleMessage(client as any, {
        chatId: 'chat-1',
        content: 'Hello',
      });

      expect(client.emit).toHaveBeenCalledWith('chat:error', {
        event: 'chat:message',
        message: 'DB error',
      });
      expect(announce).not.toHaveBeenCalled();
    });

    it('should announce the saved message with the sender name', async () => {
      const client = createMockSocket();
      const message = {
        id: BigInt(Math.floor(Math.random() * 1e6) + 1),
        chatId: randomUUID(),
        content: `Hi ${randomUUID()}`,
        type: MessageTypeEnum.TEXT,
        senderId: mockUser.id,
      };
      chatService.sendMessage.mockResolvedValue(message);
      const announce = jest.spyOn(gateway, 'announceNewMessage');

      await gateway.handleMessage(client as any, {
        chatId: message.chatId,
        content: message.content,
      });

      expect(announce).toHaveBeenCalledWith(
        message,
        `${mockUser.firstname} ${mockUser.lastname}`,
      );
    });
  });

  // ─── announceNewMessage (shared by WS and HTTP sends) ───

  describe('announceNewMessage', () => {
    const buildMessage = (senderId = randomUUID()) => ({
      id: BigInt(Math.floor(Math.random() * 1e6) + 1),
      chatId: randomUUID(),
      content: `Hello ${randomUUID()}`,
      type: MessageTypeEnum.TEXT,
      senderId,
    });

    /** Users in `online` have a socket in their personal room. */
    const withOnlineUsers = (online: string[]) => {
      (gateway.server.in as jest.Mock).mockImplementation((room: string) => ({
        fetchSockets: jest
          .fn()
          .mockResolvedValue(
            online.some((id) => room === `user:${id}`) ? [{ id: 'socket' }] : [],
          ),
      }));
    };

    it('should emit the serialized message to the chat room', () => {
      const message = buildMessage();

      gateway.announceNewMessage(message as any, 'Jane Roe');

      expect(gateway.server.to).toHaveBeenCalledWith(`chat:${message.chatId}`);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('chat:message', {
        message: { ...message, id: String(message.id) },
      });
    });

    it('should notify only the offline participants other than the sender', async () => {
      const [sender, offline, online] = [randomUUID(), randomUUID(), randomUUID()];
      const message = buildMessage(sender);
      const senderName = `Name ${randomUUID().slice(0, 6)}`;
      chatService.getChatParticipantUserIds.mockResolvedValue([sender, offline, online]);
      withOnlineUsers([sender, online]);

      gateway.announceNewMessage(message as any, senderName);
      await flushPromises();

      expect(chatService.getChatParticipantUserIds).toHaveBeenCalledWith(message.chatId);
      expect(notificationService.onNewChatMessage).toHaveBeenCalledTimes(1);
      expect(notificationService.onNewChatMessage).toHaveBeenCalledWith(
        message.chatId,
        sender,
        offline,
        senderName,
      );
    });

    it('should notify nobody when every other participant is online', async () => {
      const [sender, other] = [randomUUID(), randomUUID()];
      chatService.getChatParticipantUserIds.mockResolvedValue([sender, other]);
      withOnlineUsers([other]);

      gateway.announceNewMessage(buildMessage(sender) as any, 'Jane Roe');
      await flushPromises();

      expect(notificationService.onNewChatMessage).not.toHaveBeenCalled();
    });

    it('should log, not throw, and still notify when the room emit fails', async () => {
      const [sender, offline] = [randomUUID(), randomUUID()];
      const message = buildMessage(sender);
      chatService.getChatParticipantUserIds.mockResolvedValue([sender, offline]);
      withOnlineUsers([sender]);
      (gateway.server.to as jest.Mock).mockImplementation(() => {
        throw new Error('adapter down');
      });
      const logError = jest
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);

      expect(() => gateway.announceNewMessage(message as any, 'Jane Roe')).not.toThrow();
      await flushPromises();

      expect(logError).toHaveBeenCalledWith('Chat broadcast failed: adapter down');
      expect(notificationService.onNewChatMessage).toHaveBeenCalledWith(
        message.chatId,
        sender,
        offline,
        'Jane Roe',
      );
    });

    it('should log, not throw, when notifying fails', async () => {
      chatService.getChatParticipantUserIds.mockRejectedValue(new Error('DB down'));
      const logError = jest
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);

      expect(() => gateway.announceNewMessage(buildMessage() as any, 'Jane Roe')).not.toThrow();
      await flushPromises();

      expect(logError).toHaveBeenCalledWith('Chat notification failed: DB down');
      expect((gateway.server as any)._toEmit).toHaveBeenCalled();
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

    it('should throw WsException when content exceeds 5000 characters', async () => {
      const client = createMockSocket();
      const longContent = 'x'.repeat(5001);

      await expect(
        gateway.handleEdit(client as any, { messageId: '1', content: longContent }),
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

  // ─── Account status (bans, deactivation) ───

  describe('handshake session cookie', () => {
    // The ConfigService mock answers 'sid' for the session cookie name.
    const cookieName = 'sid';
    let sessionApp: FastifyInstance;
    let connect: ReturnType<typeof captureHandshake>;

    beforeAll(async () => {
      sessionApp = await createSessionApp(cookieName, `secret-${randomUUID()}`);
    });

    afterAll(async () => {
      await sessionApp.close();
    });

    beforeEach(() => {
      (gateway as any).adapterHost = { httpAdapter: { getInstance: () => sessionApp } };
      connect = captureHandshake(gateway);
    });

    it('should admit the user of a session issued by an HTTP login', async () => {
      const user = { ...mockUser, id: randomUUID() };
      prisma.user.findFirst.mockResolvedValue(activeStatus());
      const cookie = await loginCookie(sessionApp, cookieName, user);

      const { socket, next } = await connect({ cookie: `csrf-token=abc; ${cookie}` });

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.user.id).toBe(user.id);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: user.id } }),
      );
    });

    it('should reject a tampered session cookie without querying the DB', async () => {
      const cookie = await loginCookie(sessionApp, cookieName, { ...mockUser, id: randomUUID() });
      const tampered = cookie.slice(0, -4) + (cookie.endsWith('AAAA') ? 'BBBB' : 'AAAA');

      const { socket, next } = await connect({ cookie: tampered });

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
      expect(socket.data.user).toBeUndefined();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should reject a session cookie under another name', async () => {
      const cookie = await loginCookie(sessionApp, cookieName, { ...mockUser, id: randomUUID() });

      const { next } = await connect({ cookie: cookie.replace(/^sid=/, 'other=') });

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
    });

    it('should reject, and log, when the session cannot be decoded at all', async () => {
      (gateway as any).adapterHost = { httpAdapter: undefined };
      const warn = jest.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);

      const { next } = await connect({ cookie: 'sid=whatever' });

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Session extraction failed'));
    });
  });

  describe('handshake account check', () => {
    let connect: ReturnType<typeof captureHandshake>;
    let sessionUser: any;

    beforeEach(() => {
      sessionUser = { ...mockUser, id: randomUUID(), isBanned: false };
      jest.spyOn(gateway as any, 'extractUserFromSocket').mockImplementation(() => sessionUser);
      connect = captureHandshake(gateway);
    });

    it('should admit an active user', async () => {
      const { socket, next } = await connect();

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.user).toMatchObject({ id: sessionUser.id, isActive: true, isBanned: false });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: sessionUser.id } }),
      );
    });

    it.each([
      ['banned', { isBanned: true, banReason: 'Spam' }, 'Unauthorized: Account banned'],
      ['deactivated', { isActive: false }, 'Unauthorized: Account deactivated'],
    ])('should reject a %s user whose session predates it', async (_label, dbState, message) => {
      prisma.user.findFirst.mockResolvedValue(activeStatus(dbState));

      const { socket, next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error(message));
      expect(socket.data.user).toBeUndefined();
    });

    it('should reject a session whose user no longer exists', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const { next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
    });

    it('should reject when the account cannot be checked', async () => {
      prisma.user.findFirst.mockRejectedValue(new Error('db down'));

      const { next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized'));
    });
  });

  describe('disconnect on account block', () => {
    beforeEach(() => {
      captureHandshake(gateway);
    });

    it.each([
      ['banned', { isBanned: true }],
      ['deactivated', { isActive: false }],
    ])("should disconnect a user's open sockets once they are %s", async (_label, dbState) => {
      const userId = randomUUID();
      prisma.user.findFirst.mockResolvedValue(activeStatus(dbState));

      UserStatusCache.invalidate(userId);
      await flushPromises();

      expect(gateway.server.in).toHaveBeenCalledWith(`user:${userId}`);
      expect((gateway.server as any)._disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('should keep the sockets of a user who is still allowed in', async () => {
      UserStatusCache.invalidate(randomUUID());
      await flushPromises();

      expect((gateway.server as any)._disconnectSockets).not.toHaveBeenCalled();
    });
  });

  describe('per-action account check', () => {
    it.each([
      ['chat:message', (g: ChatGateway, c: any) => g.handleMessage(c, { chatId: 'chat-1', content: 'Hi' })],
      ['chat:edit', (g: ChatGateway, c: any) => g.handleEdit(c, { messageId: '1', content: 'Hi' })],
      ['chat:delete', (g: ChatGateway, c: any) => g.handleDelete(c, { messageId: '1' })],
    ])('should refuse %s from a user deactivated while connected', async (_event, act) => {
      const client = createMockSocket({ ...mockUser, id: randomUUID() });
      prisma.user.findFirst.mockResolvedValue(activeStatus({ isActive: false }));

      await expect(act(gateway, client)).rejects.toThrow(new WsException('Account suspended'));
      expect(chatService.sendMessage).not.toHaveBeenCalled();
      expect(chatService.editMessage).not.toHaveBeenCalled();
      expect(chatService.deleteMessage).not.toHaveBeenCalled();
    });

    it('should see a ban made after an earlier check once the status is invalidated', async () => {
      const client = createMockSocket({ ...mockUser, id: randomUUID() });
      chatService.sendMessage.mockResolvedValue({ id: 1 });
      await gateway.handleMessage(client as any, { chatId: 'chat-1', content: 'Hi' });

      prisma.user.findFirst.mockResolvedValue(activeStatus({ isBanned: true }));
      UserStatusCache.invalidate(client.data.user.id);

      await expect(
        gateway.handleMessage(client as any, { chatId: 'chat-1', content: 'Hi again' }),
      ).rejects.toThrow(new WsException('Account suspended'));
    });
  });
});
