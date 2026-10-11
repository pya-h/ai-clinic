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
import { Message, MessageTypeEnum } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { NotificationService } from '../notification/notification.service';
import { WsRateLimiter } from '../common/tools/ws-rate-limiter';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatusCache, accountBlockReason } from '../auth/user-status';
import { sessionUserFromCookieHeader } from '../auth/socket-session';

/**
 * Sockets with a chat open (between chat:join and chat:leave). Every socket is in
 * all of its user's `chat:` rooms from connect, so those can't tell who is reading.
 */
const viewingRoom = (chatId: string) => `chat-open:${chatId}`;

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
  private stopWatchingUserStatus?: () => void;

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleDestroy(): void {
    this.msgRateLimit.destroy();
    this.typingRateLimit.destroy();
    this.stopWatchingUserStatus?.();
  }

  /**
   * After Socket.IO server initializes, attach authentication middleware.
   * Validates session cookie from the WebSocket handshake headers.
   */
  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const sessionUser = this.extractUserFromSocket(socket);
        if (!sessionUser) {
          return next(new Error('Unauthorized: No valid session'));
        }
        const status = await UserStatusCache.get(this.prisma, sessionUser.id);
        if (!status) {
          return next(new Error('Unauthorized: No valid session'));
        }
        if (status.isBanned) {
          return next(new Error('Unauthorized: Account banned'));
        }
        if (!status.isActive) {
          return next(new Error('Unauthorized: Account deactivated'));
        }
        socket.data.user = { ...sessionUser, ...status };
        next();
      } catch (err) {
        this.logger.warn(`WS auth failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        next(new Error('Unauthorized'));
      }
    });

    this.stopWatchingUserStatus = UserStatusCache.onInvalidate((userId) => {
      void this.disconnectIfBlocked(userId);
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
      this.logger.error(`Failed to join chat rooms for ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
        this.logger.error(`Failed to broadcast offline for ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  // ─────────────────────────── Events ───────────────────────────

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

      this.announceNewMessage(message, `${user.firstname} ${user.lastname}`);
    } catch (err) {
      this.logger.error(`chat:message error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('chat:error', {
        event: 'chat:message',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

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

    client.to(`chat:${payload.chatId}`).emit('chat:typing', {
      userId: user.id,
      firstname: user.firstname,
      isTyping: payload.isTyping ?? false,
    });
  }

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

      client.to(`chat:${payload.chatId}`).emit('chat:read', {
        userId: user.id,
        messageId: payload.messageId,
        chatId: payload.chatId,
      });
    } catch (err) {
      this.logger.error(`chat:read error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('chat:error', {
        event: 'chat:read',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

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

      this.server.to(`chat:${message.chatId}`).emit('chat:edited', {
        message: serialized,
      });
    } catch (err) {
      this.logger.error(`chat:edit error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('chat:error', {
        event: 'chat:edit',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

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
      this.logger.error(`chat:delete error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('chat:error', {
        event: 'chat:delete',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

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
    client.join(viewingRoom(payload.chatId));

    this.notificationService
      .markChatMessagesRead(user.id, payload.chatId)
      .catch((e) => this.logger.error(`Marking chat notifications read failed: ${e.message}`));
  }

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
    client.leave(viewingRoom(payload.chatId));
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /**
   * Delivers a saved message the same way whether it was sent over WebSocket
   * or HTTP: pushed to the chat room, with participants who don't have the chat
   * open (offline, or online elsewhere) notified.
   */
  announceNewMessage(message: Message, senderName: string): void {
    // The message is already saved; a failed push must not fail the send.
    try {
      this.server.to(`chat:${message.chatId}`).emit('chat:message', {
        message: this.chatService.serializeMessage(message),
      });
    } catch (err) {
      this.logger.error(`Chat broadcast failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    this.notifyParticipantsNotViewing(
      message.chatId,
      message.senderId,
      senderName,
    ).catch((e) =>
      this.logger.error(`Chat notification failed: ${e.message}`),
    );
  }

  addUserToRoom(userId: string, chatId: string): void {
    const socketIds = this.chatService.getSocketIds(userId);
    for (const socketId of socketIds) {
      this.server.in(socketId).socketsJoin(`chat:${chatId}`);
    }
  }

  private async checkUserStatus(userId: string): Promise<void> {
    const status = await UserStatusCache.get(this.prisma, userId);
    if (!status || accountBlockReason(status)) {
      throw new WsException('Account suspended');
    }
  }

  private async disconnectIfBlocked(userId: string): Promise<void> {
    try {
      const status = await UserStatusCache.get(this.prisma, userId);
      if (!status || accountBlockReason(status)) {
        this.server.in(`user:${userId}`).disconnectSockets(true);
      }
    } catch (err) {
      this.logger.error(`Status re-check failed for ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async notifyParticipantsNotViewing(
    chatId: string,
    senderId: string,
    senderName: string,
  ): Promise<void> {
    const participantIds = await this.chatService.getChatParticipantUserIds(chatId);
    const viewers = new Set(
      (await this.server.in(viewingRoom(chatId)).fetchSockets()).map((socket) => socket.data.user?.id),
    );

    for (const participantUserId of participantIds) {
      if (participantUserId === senderId || viewers.has(participantUserId)) continue;
      await this.notificationService.onNewChatMessage(
        chatId,
        senderId,
        participantUserId,
        senderName,
      );
    }
  }

  private extractUserFromSocket(socket: Socket): any | null {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return null;

    try {
      return sessionUserFromCookieHeader(
        this.adapterHost.httpAdapter.getInstance<FastifyInstance>(),
        cookieHeader,
        this.configService.get<string>('auth.sessionCookieName') || 'sid',
      );
    } catch (err) {
      this.logger.warn(`Session extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    }
  }
}
