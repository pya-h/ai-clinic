import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { MessageTypeEnum } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { NotificationService } from '../notification/notification.service';
import { WsRateLimiter } from '../common/tools/ws-rate-limiter';

/**
 * Chat WebSocket Gateway
 *
 * Provides real-time messaging (chat:message), typing indicators (chat:typing),
 * read receipts (chat:read), message editing/deletion, and online presence
 * (user:online). Uses Socket.IO namespace /chat.
 *
 * Auth: session cookie validation in afterInit middleware.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()),
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly msgRateLimit = new WsRateLimiter(20, 10_000);
  private readonly typingRateLimit = new WsRateLimiter(30, 10_000);
  private readonly userStatusCache = new Map<string, { isActive: boolean; isBanned: boolean; checkedAt: number }>();
  private static readonly STATUS_CACHE_TTL = 60_000;

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  onModuleDestroy(): void {
    this.msgRateLimit.destroy();
    this.typingRateLimit.destroy();
    this.userStatusCache.clear();
  }

  /**
   * After Socket.IO server initializes, attach authentication middleware.
   * Validates session cookie from the WebSocket handshake headers.
   */
  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const user = this.extractUserFromSocket(socket);
        if (!user) {
          return next(new Error('Unauthorized: No valid session'));
        }
        if (user.isActive === false) {
          return next(new Error('Unauthorized: Account deactivated'));
        }
        if (user.isBanned === true) {
          return next(new Error('Unauthorized: Account banned'));
        }
        socket.data.user = user;
        next();
      } catch (err) {
        this.logger.warn(`WS auth failed: ${err.message}`);
        next(new Error('Unauthorized'));
      }
    });

    this.logger.log('ChatGateway initialized with auth middleware');
  }

  /**
   * When a client connects:
   * 1. Track their presence (online)
   * 2. Join personal room (user:{userId})
   * 3. Join all their chat rooms (chat:{chatId})
   * 4. Broadcast online status to relevant users
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      client.disconnect(true);
      return;
    }

    const wasOnline = this.chatService.isOnline(user.id);
    this.chatService.setOnline(user.id, client.id);

    client.join(`user:${user.id}`);

    let chatIds: string[] = [];
    try {
      chatIds = await this.chatService.getUserChatIds(user.id);
      for (const chatId of chatIds) {
        client.join(`chat:${chatId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to join chat rooms for ${user.id}: ${err.message}`);
    }

    if (!wasOnline && chatIds.length > 0) {
      const rooms = chatIds.map(id => `chat:${id}`);
      this.server.to(rooms).emit('user:online', {
        userId: user.id,
        isOnline: true,
      });
    }
  }

  /**
   * When a client disconnects:
   * 1. Remove from presence tracking
   * 2. If user has no more connected sockets, broadcast offline
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const user = client.data.user;
    if (!user) return;

    this.chatService.setOffline(user.id, client.id);

    if (!this.chatService.isOnline(user.id)) {
      try {
        const chatIds = await this.chatService.getUserChatIds(user.id);
        if (chatIds.length > 0) {
          const rooms = chatIds.map(id => `chat:${id}`);
          this.server.to(rooms).emit('user:online', {
            userId: user.id,
            isOnline: false,
          });
        }
      } catch (err) {
        this.logger.error(`Failed to broadcast offline for ${user.id}: ${err.message}`);
      }
    }
  }

  // ─────────────────────────── Events ───────────────────────────

  /**
   * Handle incoming chat message.
   * Saves to DB and broadcasts to all participants in the room.
   */
  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      chatId: string;
      content: string;
      type?: MessageTypeEnum;
      fileUrl?: string;
      repliedToId?: string;
    },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:message');

    if (!payload.chatId || !payload.content) {
      throw new WsException('chatId and content are required');
    }
    if (payload.content.length > 5000) {
      throw new WsException('Message content exceeds 5000 characters');
    }
    if (payload.type && !Object.values(MessageTypeEnum).includes(payload.type)) {
      throw new WsException('Invalid message type');
    }

    await this.checkUserStatus(user.id);

    try {
      const message = await this.chatService.sendMessage(
        payload.chatId,
        user.id,
        {
          content: payload.content,
          type: payload.type || MessageTypeEnum.TEXT,
          fileUrl: payload.fileUrl,
          repliedToId: payload.repliedToId,
        },
      );

      const serialized = this.chatService.serializeMessage(message);

      // Broadcast to all participants in the chat room
      this.server.to(`chat:${payload.chatId}`).emit('chat:message', {
        message: serialized,
      });

      this.notifyOfflineParticipants(
        payload.chatId,
        user.id,
        `${user.firstname} ${user.lastname}`,
      ).catch((e) =>
        this.logger.error(`Chat notification failed: ${e.message}`),
      );
    } catch (err) {
      this.logger.error(`chat:message error: ${err.message}`);
      client.emit('chat:error', {
        event: 'chat:message',
        message: err.message,
      });
    }
  }

  /**
   * Handle typing indicator.
   * Broadcasts to other participants in the chat room.
   */
  @SubscribeMessage('chat:typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string; isTyping: boolean },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.typingRateLimit.check(user.id, 'chat:typing');

    if (!payload.chatId) {
      throw new WsException('chatId is required');
    }

    await this.chatService.assertChatParticipant(payload.chatId, user.id);

    // Broadcast to others (not back to sender)
    client.to(`chat:${payload.chatId}`).emit('chat:typing', {
      userId: user.id,
      firstname: user.firstname,
      isTyping: payload.isTyping ?? false,
    });
  }

  /**
   * Handle read receipt.
   * Marks messages as read in DB and notifies other participants.
   */
  @SubscribeMessage('chat:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string; messageId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:read');

    if (!payload.chatId || !payload.messageId) {
      throw new WsException('chatId and messageId are required');
    }

    try {
      await this.chatService.markAsRead(
        payload.chatId,
        user.id,
        BigInt(payload.messageId),
      );

      // Notify others about the read receipt
      client.to(`chat:${payload.chatId}`).emit('chat:read', {
        userId: user.id,
        messageId: payload.messageId,
        chatId: payload.chatId,
      });
    } catch (err) {
      this.logger.error(`chat:read error: ${err.message}`);
      client.emit('chat:error', {
        event: 'chat:read',
        message: err.message,
      });
    }
  }

  /**
   * Handle message edit.
   */
  @SubscribeMessage('chat:edit')
  async handleEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; content: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:edit');

    if (!payload.messageId || !payload.content) {
      throw new WsException('messageId and content are required');
    }
    if (payload.content.length > 5000) {
      throw new WsException('Message content exceeds 5000 characters');
    }

    await this.checkUserStatus(user.id);

    try {
      const message = await this.chatService.editMessage(
        BigInt(payload.messageId),
        user.id,
        payload.content,
      );

      const serialized = this.chatService.serializeMessage(message);

      // Find the chat to broadcast to
      this.server.to(`chat:${message.chatId}`).emit('chat:edited', {
        message: serialized,
      });
    } catch (err) {
      this.logger.error(`chat:edit error: ${err.message}`);
      client.emit('chat:error', {
        event: 'chat:edit',
        message: err.message,
      });
    }
  }

  /**
   * Handle message deletion (soft delete).
   */
  @SubscribeMessage('chat:delete')
  async handleDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:delete');

    if (!payload.messageId) {
      throw new WsException('messageId is required');
    }

    await this.checkUserStatus(user.id);

    try {
      const message = await this.chatService.deleteMessage(
        BigInt(payload.messageId),
        user.id,
      );

      const serialized = this.chatService.serializeMessage(message);

      this.server.to(`chat:${message.chatId}`).emit('chat:deleted', {
        message: serialized,
      });
    } catch (err) {
      this.logger.error(`chat:delete error: ${err.message}`);
      client.emit('chat:error', {
        event: 'chat:delete',
        message: err.message,
      });
    }
  }

  /**
   * Client explicitly joins a chat room (e.g. when viewing a chat).
   */
  @SubscribeMessage('chat:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:join');

    if (!payload.chatId) {
      throw new WsException('chatId is required');
    }

    await this.chatService.assertChatParticipant(payload.chatId, user.id);

    client.join(`chat:${payload.chatId}`);
  }

  /**
   * Client explicitly leaves a chat room.
   */
  @SubscribeMessage('chat:leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string },
  ): void {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    this.msgRateLimit.check(user.id, 'chat:leave');

    if (!payload.chatId) {
      throw new WsException('chatId is required');
    }

    client.leave(`chat:${payload.chatId}`);
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /**
   * Utility: let the gateway add a user to a chat room in real-time
   * (e.g., when a new chat is created via REST API).
   */
  addUserToRoom(userId: string, chatId: string): void {
    const socketIds = this.chatService.getSocketIds(userId);
    for (const socketId of socketIds) {
      // Use Socket.IO's server-side room API to join the user's socket
      this.server.in(socketId).socketsJoin(`chat:${chatId}`);
    }
  }

  /**
   * Extract user from Socket.IO handshake by parsing the secure session cookie.
   *
   * @fastify/secure-session stores data in an encrypted cookie. We need to
   * parse it the same way the Fastify plugin does — using sodium-native
   * with a key derived from SESSION_SECRET.
   *
   * For WebSocket auth, we attempt to parse the signed session cookie.
   * Since the WS handshake is an HTTP upgrade, the cookie header is available.
   */
  private async checkUserStatus(userId: string): Promise<void> {
    const now = Date.now();
    const cached = this.userStatusCache.get(userId);
    if (cached && now - cached.checkedAt < ChatGateway.STATUS_CACHE_TTL) {
      if (!cached.isActive || cached.isBanned) {
        throw new WsException('Account suspended');
      }
      return;
    }
    const status = await this.chatService.getUserStatus(userId);
    this.userStatusCache.set(userId, { ...status, checkedAt: now });
    if (!status.isActive || status.isBanned) {
      throw new WsException('Account suspended');
    }
  }

  private async notifyOfflineParticipants(
    chatId: string,
    senderId: string,
    senderName: string,
  ): Promise<void> {
    const participantIds = await this.chatService.getChatParticipantUserIds(chatId);

    for (const participantUserId of participantIds) {
      if (participantUserId === senderId) continue;
      const sockets = await this.server.in(`user:${participantUserId}`).fetchSockets();
      if (sockets.length === 0) {
        await this.notificationService.onNewChatMessage(
          chatId,
          senderId,
          participantUserId,
          senderName,
        );
      }
    }
  }

  private extractUserFromSocket(socket: Socket): any | null {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return null;

      const cookieName =
        this.configService.get<string>('auth.sessionCookieName') || 'sid';

      // Parse the cookie string
      const cookies = this.parseCookies(cookieHeader);
      const sessionCookie = cookies[cookieName];
      if (!sessionCookie) return null;

      // Decode the secure session
      const sessionSecret = this.configService.getOrThrow<string>(
        'auth.sessionSecret',
      );
      const key = createHash('sha256').update(sessionSecret).digest();

      // @fastify/secure-session uses sodium-native to encrypt.
      // The cookie value is base64-encoded: nonce (24 bytes) + cipher.
      // We use sodium's crypto_secretbox_open_easy to decrypt.
      const sodium = require('sodium-native');
      const raw = Buffer.from(sessionCookie, 'base64');
      if (raw.length < 25) return null; // nonce(24) + at least 1 byte

      const nonce = raw.subarray(0, 24);
      const cipher = raw.subarray(24);

      const plaintext = Buffer.alloc(cipher.length - sodium.crypto_secretbox_MACBYTES);
      const opened = sodium.crypto_secretbox_open_easy(
        plaintext,
        cipher,
        nonce,
        key,
      );

      if (!opened) return null;

      const session = JSON.parse(plaintext.toString('utf-8'));
      return session?.user || null;
    } catch (err) {
      this.logger.warn(`Session extraction failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Simple cookie string parser.
   */
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) {
        cookies[name.trim()] = decodeURIComponent(rest.join('='));
      }
    });
    return cookies;
  }
}
