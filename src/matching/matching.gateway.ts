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
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { MatchingService } from './matching.service';
import { MatchStatusEnum } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

@WebSocketGateway({
  namespace: '/matching',
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()),
    credentials: true,
  },
})
export class MatchingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MatchingGateway.name);
  private readonly patientTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly matchingService: MatchingService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  onModuleDestroy(): void {
    for (const [, timer] of this.patientTimers) {
      clearTimeout(timer);
    }
    this.patientTimers.clear();
  }

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const user = this.extractUserFromSocket(socket);
        if (!user) return next(new Error('Unauthorized: No valid session'));
        if (user.isActive === false) return next(new Error('Unauthorized: Account deactivated'));
        socket.data.user = user;
        next();
      } catch (err) {
        this.logger.warn(`WS auth failed: ${err.message}`);
        next(new Error('Unauthorized'));
      }
    });
    this.logger.log('MatchingGateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.join(`user:${user.id}`);
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user;
    if (!user) return;
    client.leave(`user:${user.id}`);
  }

  // ─────────────── Patient: Request a Match ───────────────

  @SubscribeMessage('match:request')
  async handleMatchRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { soapId?: string; specialty?: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');

    try {
      const { matchRequest, doctors } =
        await this.matchingService.createMatchRequest(
          user,
          payload.soapId,
          payload.specialty as any,
        );

      client.emit('match:searching', {
        matchRequestId: matchRequest.id,
        candidates: doctors.length,
      });

      if (doctors.length > 0) {
        await this.offerToTopDoctor(matchRequest.id, doctors);
      }

      this.startTimeout(matchRequest.id, user.id);
    } catch (err) {
      this.logger.error(`match:request error: ${err.message}`);
      client.emit('match:error', { message: err.message });
    }
  }

  // ─────────────── Doctor: Accept ───────────────

  @SubscribeMessage('match:accept')
  async handleAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    if (!payload.matchRequestId) throw new WsException('matchRequestId is required');

    try {
      const { matchRequest, consultationId } =
        await this.matchingService.acceptMatch(payload.matchRequestId, user);

      this.clearTimeout(payload.matchRequestId);

      client.emit('match:accepted', {
        matchRequestId: matchRequest.id,
        consultationId,
      });

      this.server.to(`user:${matchRequest.patientId}`).emit('match:accepted', {
        matchRequestId: matchRequest.id,
        consultationId,
        doctor: {
          userId: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
        },
      });

      this.notificationService
        .onMatchAccepted(
          matchRequest.patientId,
          consultationId,
          `${user.firstname} ${user.lastname}`,
        )
        .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
    } catch (err) {
      this.logger.error(`match:accept error: ${err.message}`);
      client.emit('match:error', { message: err.message });
    }
  }

  // ─────────────── Doctor: Reject ───────────────

  @SubscribeMessage('match:reject')
  async handleReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    if (!payload.matchRequestId) throw new WsException('matchRequestId is required');

    try {
      const { matchRequest, nextDoctors } =
        await this.matchingService.rejectMatch(payload.matchRequestId, user);

      client.emit('match:rejected', {
        matchRequestId: matchRequest.id,
      });

      if (nextDoctors.length > 0) {
        await this.offerToTopDoctor(matchRequest.id, nextDoctors);
      } else {
        await this.matchingService.timeoutRequest(matchRequest.id);
        this.clearTimeout(matchRequest.id);
        this.server
          .to(`user:${matchRequest.patientId}`)
          .emit('match:timeout', { matchRequestId: matchRequest.id });
      }
    } catch (err) {
      this.logger.error(`match:reject error: ${err.message}`);
      client.emit('match:error', { message: err.message });
    }
  }

  // ─────────────── Patient: Cancel ───────────────

  @SubscribeMessage('match:cancel')
  async handleCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    if (!payload.matchRequestId) throw new WsException('matchRequestId is required');

    try {
      const matchRequest = await this.matchingService.cancelRequest(
        payload.matchRequestId,
        user,
      );

      this.clearTimeout(payload.matchRequestId);
      client.emit('match:cancelled', { matchRequestId: matchRequest.id });

      if (matchRequest.matchedDoctorId) {
        const doctor = await this.getDoctorUserId(matchRequest.matchedDoctorId);
        if (doctor) {
          this.server
            .to(`user:${doctor}`)
            .emit('match:cancelled', { matchRequestId: matchRequest.id });
        }
      }
    } catch (err) {
      this.logger.error(`match:cancel error: ${err.message}`);
      client.emit('match:error', { message: err.message });
    }
  }

  // ─────────────── Helpers ───────────────

  private async offerToTopDoctor(
    matchRequestId: string,
    doctors: { doctorId: number; userId: string; firstname: string; lastname: string }[],
  ): Promise<void> {
    const topDoctor = doctors[0];

    await this.matchingService.matchDoctor(matchRequestId, topDoctor.doctorId);

    this.server.to(`user:${topDoctor.userId}`).emit('match:request', {
      matchRequestId,
      doctorId: topDoctor.doctorId,
    });

    this.notificationService
      .onMatchFound(topDoctor.userId, matchRequestId)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));
  }

  private startTimeout(matchRequestId: string, patientId: string): void {
    const timer = setTimeout(async () => {
      try {
        const request = await this.matchingService.timeoutRequest(matchRequestId);
        if (
          request.status === MatchStatusEnum.TIMEOUT
        ) {
          this.server
            .to(`user:${patientId}`)
            .emit('match:timeout', { matchRequestId });
        }
      } catch (err) {
        this.logger.error(`Timeout handler error: ${err.message}`);
      }
    }, 5 * 60 * 1000);

    this.patientTimers.set(matchRequestId, timer);
  }

  private clearTimeout(matchRequestId: string): void {
    const timer = this.patientTimers.get(matchRequestId);
    if (timer) {
      clearTimeout(timer);
      this.patientTimers.delete(matchRequestId);
    }
  }

  private async getDoctorUserId(doctorProfileId: number): Promise<string | null> {
    return this.matchingService.getDoctorUserId(doctorProfileId);
  }

  private extractUserFromSocket(socket: Socket): any | null {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return null;

      const cookieName =
        this.configService.get<string>('auth.sessionCookieName') || 'sid';

      const cookies: Record<string, string> = {};
      cookieHeader.split(';').forEach((cookie) => {
        const [name, ...rest] = cookie.trim().split('=');
        if (name) cookies[name.trim()] = decodeURIComponent(rest.join('='));
      });

      const sessionCookie = cookies[cookieName];
      if (!sessionCookie) return null;

      const sessionSecret = this.configService.getOrThrow<string>(
        'auth.sessionSecret',
      );
      const key = createHash('sha256').update(sessionSecret).digest();

      const sodium = require('sodium-native');
      const raw = Buffer.from(sessionCookie, 'base64');
      if (raw.length < 25) return null;

      const nonce = raw.subarray(0, 24);
      const cipher = raw.subarray(24);

      const plaintext = Buffer.alloc(
        cipher.length - sodium.crypto_secretbox_MACBYTES,
      );
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
}
