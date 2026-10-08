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
import { DoctorSpecialtiesEnum, MatchRequest, MatchStatusEnum } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { WsRateLimiter } from '../common/tools/ws-rate-limiter';

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
  private readonly rateLimit = new WsRateLimiter(5, 10_000);

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
    this.rateLimit.destroy();
  }

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const user = this.extractUserFromSocket(socket);
        if (!user) return next(new Error('Unauthorized: No valid session'));
        if (user.isActive === false) return next(new Error('Unauthorized: Account deactivated'));
        if (user.isBanned === true) return next(new Error('Unauthorized: Account banned'));
        socket.data.user = user;
        next();
      } catch (err) {
        this.logger.warn(`WS auth failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
    this.rateLimit.check(user.id, 'match:request');

    try {
      if (payload.specialty && !Object.values(DoctorSpecialtiesEnum).includes(payload.specialty as DoctorSpecialtiesEnum)) {
        throw new WsException(`Invalid specialty: ${payload.specialty}`);
      }

      const { matchRequest, doctors } =
        await this.matchingService.createMatchRequest(
          user,
          payload.soapId,
          payload.specialty as DoctorSpecialtiesEnum | undefined,
        );

      client.emit('match:searching', {
        matchRequestId: matchRequest.id,
        candidates: doctors.length,
      });

      await this.dispatchMatchRequest(matchRequest, doctors);
    } catch (err) {
      this.logger.error(`match:request error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('match:error', { message: err instanceof Error ? err.message : 'Unknown error' });
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
    this.rateLimit.check(user.id, 'match:accept');
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
      this.logger.error(`match:accept error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('match:error', { message: err instanceof Error ? err.message : 'Unknown error' });
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
    this.rateLimit.check(user.id, 'match:reject');
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
      this.logger.error(`match:reject error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('match:error', { message: err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Unknown error' });
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
    this.rateLimit.check(user.id, 'match:cancel');
    if (!payload.matchRequestId) throw new WsException('matchRequestId is required');

    try {
      const matchRequest = await this.matchingService.cancelRequest(
        payload.matchRequestId,
        user,
      );

      client.emit('match:cancelled', { matchRequestId: matchRequest.id });

      await this.notifyMatchCancelled(matchRequest);
    } catch (err) {
      this.logger.error(`match:cancel error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      client.emit('match:error', { message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  // ─────────────── Shared Flow (WS + REST) ───────────────

  /**
   * Starts the patient timeout for a newly created match request and offers it
   * to the top-scored doctor. Used by both the `match:request` WS handler and
   * `POST /matching/request`, so both paths actually reach a doctor.
   * Returns the latest state of the request (MATCHED once offered).
   */
  async dispatchMatchRequest(
    matchRequest: MatchRequest,
    doctors: { doctorId: number; userId: string; firstname: string; lastname: string }[],
  ): Promise<MatchRequest> {
    this.startTimeout(matchRequest.id, matchRequest.patientId);

    if (doctors.length === 0) return matchRequest;
    return this.offerToTopDoctor(matchRequest.id, doctors);
  }

  /**
   * Clears the timeout of a cancelled match request and tells the offered
   * doctor (if any) that it was withdrawn. Used by both the `match:cancel` WS
   * handler and `PATCH /matching/:id/cancel`. Never throws: the cancellation
   * itself has already succeeded.
   */
  async notifyMatchCancelled(matchRequest: MatchRequest): Promise<void> {
    this.clearTimeout(matchRequest.id);

    if (!matchRequest.matchedDoctorId) return;
    try {
      const doctorUserId = await this.getDoctorUserId(matchRequest.matchedDoctorId);
      if (doctorUserId) {
        this.server
          .to(`user:${doctorUserId}`)
          .emit('match:cancelled', { matchRequestId: matchRequest.id });
      }
    } catch (err) {
      this.logger.error(`Cancel notification failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ─────────────── Helpers ───────────────

  private async offerToTopDoctor(
    matchRequestId: string,
    doctors: { doctorId: number; userId: string; firstname: string; lastname: string }[],
  ): Promise<MatchRequest> {
    const topDoctor = doctors[0];

    const matchRequest = await this.matchingService.matchDoctor(matchRequestId, topDoctor.doctorId);

    this.server.to(`user:${topDoctor.userId}`).emit('match:request', {
      matchRequestId,
      doctorId: topDoctor.doctorId,
    });

    this.notificationService
      .onMatchFound(topDoctor.userId, matchRequestId)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    return matchRequest;
  }

  private startTimeout(matchRequestId: string, patientId: string): void {
    // Never orphan a running timer for the same request (it could not be cleared anymore)
    this.clearTimeout(matchRequestId);

    const timer = setTimeout(async () => {
      this.patientTimers.delete(matchRequestId);
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
        this.logger.error(`Timeout handler error: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

      // @fastify/secure-session encodes as "cipher_b64;nonce_b64"
      const parts = sessionCookie.split(';');
      if (parts.length < 2) return null;

      const cipher = Buffer.from(parts[0], 'base64');
      const nonce = Buffer.from(parts[1], 'base64');

      if (nonce.length !== sodium.crypto_secretbox_NONCEBYTES) return null;
      if (cipher.length < sodium.crypto_secretbox_MACBYTES) return null;

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
      this.logger.warn(`Session extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    }
  }
}
