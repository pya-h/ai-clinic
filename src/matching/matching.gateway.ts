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
import {
  Inject,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { MatchingService } from './matching.service';
import {
  DoctorSpecialtiesEnum,
  MatchRequest,
  MatchStatusEnum,
  UserRolesEnum,
} from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { WsRateLimiter } from '../common/tools/ws-rate-limiter';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatusCache, accountBlockReason } from '../auth/user-status';
import { sessionUserFromCookieHeader } from '../auth/socket-session';

const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
const OFFER_TIMEOUT_MS = 45_000;

@WebSocketGateway({
  namespace: '/matching',
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  },
})
export class MatchingGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationBootstrap,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MatchingGateway.name);
  private readonly patientTimers = new Map<string, NodeJS.Timeout>();
  private readonly offerTimers = new Map<string, NodeJS.Timeout>();
  private readonly rateLimit = new WsRateLimiter(5, 10_000);
  private stopWatchingUserStatus?: () => void;
  private expirySweep?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly matchingService: MatchingService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    void this.expireStaleRequests();
    this.expirySweep = setInterval(
      () => void this.expireStaleRequests(),
      EXPIRY_SWEEP_INTERVAL_MS,
    );
    this.expirySweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.expirySweep);
    for (const [, timer] of this.patientTimers) {
      clearTimeout(timer);
    }
    this.patientTimers.clear();
    for (const [, timer] of this.offerTimers) {
      clearTimeout(timer);
    }
    this.offerTimers.clear();
    this.rateLimit.destroy();
    this.stopWatchingUserStatus?.();
  }

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const sessionUser = this.extractUserFromSocket(socket);
        if (!sessionUser)
          return next(new Error('Unauthorized: No valid session'));
        const status = await UserStatusCache.get(this.prisma, sessionUser.id);
        if (!status) return next(new Error('Unauthorized: No valid session'));
        if (status.isBanned)
          return next(new Error('Unauthorized: Account banned'));
        if (!status.isActive)
          return next(new Error('Unauthorized: Account deactivated'));
        socket.data.user = { ...sessionUser, ...status };
        next();
      } catch (err) {
        this.logger.warn(
          `WS auth failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
        next(new Error('Unauthorized'));
      }
    });
    this.stopWatchingUserStatus = UserStatusCache.onInvalidate((userId) => {
      void this.disconnectIfBlocked(userId);
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
    if (user.role === UserRolesEnum.DOCTOR) {
      this.matchingService.markDoctorOnline?.(user.id);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user;
    if (!user) return;
    client.leave(`user:${user.id}`);
    if (user.role === UserRolesEnum.DOCTOR) {
      this.matchingService.markDoctorOffline?.(user.id);
    }
  }

  // ─────────────── Patient: Request a Match ───────────────

  @SubscribeMessage('match:request')
  async handleMatchRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { soapId?: string; specialty?: string },
  ): Promise<void> {
    if (!client.data.user) throw new WsException('Unauthorized');
    this.rateLimit.check(client.data.user.id, 'match:request');
    const user = await this.currentUser(client);

    try {
      const safePayload = payload && typeof payload === 'object' ? payload : {};
      if (
        safePayload.specialty &&
        !Object.values(DoctorSpecialtiesEnum).includes(
          safePayload.specialty as DoctorSpecialtiesEnum,
        )
      ) {
        throw new WsException(`Invalid specialty: ${safePayload.specialty}`);
      }

      const { matchRequest, doctors } =
        await this.matchingService.createMatchRequest(
          user,
          safePayload.soapId,
          safePayload.specialty as DoctorSpecialtiesEnum | undefined,
        );

      client.emit('match:searching', {
        matchRequestId: matchRequest.id,
        candidates: doctors.length,
      });

      await this.dispatchMatchRequest(matchRequest, doctors);
    } catch (err) {
      this.logger.error(
        `match:request error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      client.emit('match:error', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // ─────────────── Doctor: Accept ───────────────

  @SubscribeMessage('match:accept')
  async handleAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    if (!client.data.user) throw new WsException('Unauthorized');
    this.rateLimit.check(client.data.user.id, 'match:accept');
    const user = await this.currentUser(client);
    if (!payload || typeof payload !== 'object' || !payload.matchRequestId)
      throw new WsException('matchRequestId is required');

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
      this.logger.error(
        `match:accept error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      client.emit('match:error', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // ─────────────── Doctor: Reject ───────────────

  @SubscribeMessage('match:reject')
  async handleReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    if (!client.data.user) throw new WsException('Unauthorized');
    this.rateLimit.check(client.data.user.id, 'match:reject');
    const user = await this.currentUser(client);
    if (!payload || typeof payload !== 'object' || !payload.matchRequestId)
      throw new WsException('matchRequestId is required');

    try {
      this.clearOfferTimeout(payload.matchRequestId);
      const { matchRequest, nextDoctors } =
        await this.matchingService.rejectMatch(payload.matchRequestId, user);

      client.emit('match:rejected', {
        matchRequestId: matchRequest.id,
      });

      if (nextDoctors.length > 0) {
        await this.offerNextOrRetire(
          matchRequest.id,
          matchRequest.patientId,
          nextDoctors,
        );
      } else {
        await this.retireExhaustedRequest(
          matchRequest.id,
          matchRequest.patientId,
        );
      }
    } catch (err) {
      this.logger.error(
        `match:reject error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      client.emit('match:error', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // ─────────────── Patient: Cancel ───────────────

  @SubscribeMessage('match:cancel')
  async handleCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchRequestId: string },
  ): Promise<void> {
    if (!client.data.user) throw new WsException('Unauthorized');
    this.rateLimit.check(client.data.user.id, 'match:cancel');
    const user = await this.currentUser(client);
    if (!payload || typeof payload !== 'object' || !payload.matchRequestId)
      throw new WsException('matchRequestId is required');

    try {
      const matchRequest = await this.matchingService.cancelRequest(
        payload.matchRequestId,
        user,
      );

      client.emit('match:cancelled', { matchRequestId: matchRequest.id });

      await this.notifyMatchCancelled(matchRequest);
    } catch (err) {
      this.logger.error(
        `match:cancel error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      client.emit('match:error', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // ─────────────── Shared Flow (WS + REST) ───────────────

  async dispatchMatchRequest(
    matchRequest: MatchRequest,
    doctors: {
      doctorId: number;
      userId: string;
      firstname: string;
      lastname: string;
    }[],
  ): Promise<MatchRequest> {
    this.startTimeout(matchRequest.id, matchRequest.patientId);

    if (doctors.length === 0) return matchRequest;
    try {
      return await this.offerToTopDoctor(matchRequest.id, doctors);
    } catch (err) {
      // Left active, the request would block the patient's retries until it timed out.
      this.clearTimeout(matchRequest.id);
      await this.matchingService
        .timeoutRequest(matchRequest.id)
        .catch((e) =>
          this.logger.error(
            `Retiring match request ${matchRequest.id} failed: ${e.message}`,
          ),
        );
      throw err;
    }
  }

  /** Never throws: the cancellation itself has already succeeded. */
  async notifyMatchCancelled(matchRequest: MatchRequest): Promise<void> {
    this.clearTimeout(matchRequest.id);

    if (!matchRequest.matchedDoctorId) return;
    try {
      const doctorUserId = await this.getDoctorUserId(
        matchRequest.matchedDoctorId,
      );
      if (doctorUserId) {
        this.server
          .to(`user:${doctorUserId}`)
          .emit('match:cancelled', { matchRequestId: matchRequest.id });
      }
    } catch (err) {
      this.logger.error(
        `Cancel notification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  /** Never throws: it runs unattended. */
  async expireStaleRequests(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const expired = await this.matchingService.expireStaleRequests();
      for (const request of expired) {
        this.clearTimeout(request.id);
        await this.announceTimeout(request).catch((err) =>
          this.logger.error(
            `Timeout notice for ${request.id} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          ),
        );
      }
    } catch (err) {
      this.logger.error(
        `Match request expiry sweep failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  // ─────────────── Helpers ───────────────

  private async offerToTopDoctor(
    matchRequestId: string,
    doctors: {
      doctorId: number;
      userId: string;
      firstname: string;
      lastname: string;
    }[],
  ): Promise<MatchRequest> {
    const topDoctor = doctors[0];

    const matchRequest = await this.matchingService.matchDoctor(
      matchRequestId,
      topDoctor.doctorId,
    );

    this.server.to(`user:${topDoctor.userId}`).emit('match:request', {
      matchRequestId,
      doctorId: topDoctor.doctorId,
    });

    if (matchRequest?.patientId) {
      this.server.to(`user:${matchRequest.patientId}`).emit('match:offered', {
        matchRequestId,
        doctorId: topDoctor.doctorId,
      });
    }

    this.notificationService
      .onMatchFound(topDoctor.userId, matchRequestId)
      .catch((e) => this.logger.error(`Notification failed: ${e.message}`));

    this.startOfferTimeout(
      matchRequestId,
      topDoctor.doctorId,
      topDoctor.userId,
      matchRequest?.createdAt,
    );

    return matchRequest;
  }

  private async offerNextOrRetire(
    matchRequestId: string,
    patientId: string,
    candidates: {
      doctorId: number;
      userId: string;
      firstname: string;
      lastname: string;
    }[],
  ): Promise<void> {
    for (let i = 0; i < candidates.length; i++) {
      try {
        await this.offerToTopDoctor(matchRequestId, candidates.slice(i));
        return;
      } catch (err) {
        this.logger.warn(
          `Cascading offer to doctor ${candidates[i].doctorId} failed for ${matchRequestId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }
    await this.retireExhaustedRequest(matchRequestId, patientId);
  }

  private async retireExhaustedRequest(
    matchRequestId: string,
    patientId: string,
  ): Promise<void> {
    this.clearTimeout(matchRequestId);
    const timedOut = this.matchingService.timeoutRequestIfActive
      ? await this.matchingService.timeoutRequestIfActive(matchRequestId)
      : await this.matchingService.timeoutRequest(matchRequestId);
    if (timedOut && timedOut.status === MatchStatusEnum.TIMEOUT) {
      await this.announceTimeout({
        id: matchRequestId,
        patientId,
        matchedDoctorId: null,
      });
    }
  }

  private startOfferTimeout(
    matchRequestId: string,
    offeredDoctorId: number,
    offeredDoctorUserId: string,
    createdAt?: Date | string,
  ): void {
    this.clearOfferTimeout(matchRequestId);

    const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
    const remainingMs = Number.isNaN(createdMs)
      ? OFFER_TIMEOUT_MS
      : Math.max(1_000, 5 * 60 * 1000 - (Date.now() - createdMs));
    const delayMs = Math.min(OFFER_TIMEOUT_MS, remainingMs);

    const timer = setTimeout(async () => {
      this.offerTimers.delete(matchRequestId);
      try {
        const result = await this.matchingService.cascadeTimedOutOffer?.(
          matchRequestId,
          offeredDoctorId,
        );
        if (!result) return;

        this.server
          .to(`user:${offeredDoctorUserId}`)
          .emit('match:offer_expired', { matchRequestId });

        if (result.nextDoctors.length > 0) {
          await this.offerNextOrRetire(
            matchRequestId,
            result.matchRequest.patientId,
            result.nextDoctors,
          );
        } else {
          await this.retireExhaustedRequest(
            matchRequestId,
            result.matchRequest.patientId,
          );
        }
      } catch (err) {
        this.logger.error(
          `Offer cascade error for ${matchRequestId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }, delayMs);
    timer.unref();

    this.offerTimers.set(matchRequestId, timer);
  }

  private clearOfferTimeout(matchRequestId: string): void {
    const timer = this.offerTimers.get(matchRequestId);
    if (timer) {
      clearTimeout(timer);
      this.offerTimers.delete(matchRequestId);
    }
  }

  private startTimeout(matchRequestId: string, patientId: string): void {
    // A replaced timer would be orphaned and could never be cleared
    this.clearTimeout(matchRequestId);

    const timer = setTimeout(
      async () => {
        this.patientTimers.delete(matchRequestId);
        try {
          const request = this.matchingService.timeoutRequestIfActive
            ? await this.matchingService.timeoutRequestIfActive(matchRequestId)
            : await this.matchingService.timeoutRequest(matchRequestId);
          if (request && request.status === MatchStatusEnum.TIMEOUT) {
            await this.announceTimeout({
              id: matchRequestId,
              patientId,
              matchedDoctorId: request.matchedDoctorId,
            });
          }
        } catch (err) {
          this.logger.error(
            `Timeout handler error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      },
      5 * 60 * 1000,
    );
    timer.unref();

    this.patientTimers.set(matchRequestId, timer);
  }

  private async announceTimeout(
    request: Pick<MatchRequest, 'id' | 'patientId' | 'matchedDoctorId'>,
  ): Promise<void> {
    const matchRequestId = request.id;
    this.server
      .to(`user:${request.patientId}`)
      .emit('match:timeout', { matchRequestId });
    // The doctor holding the offer can no longer accept it.
    const doctorUserId = request.matchedDoctorId
      ? await this.getDoctorUserId(request.matchedDoctorId)
      : null;
    if (doctorUserId) {
      this.server
        .to(`user:${doctorUserId}`)
        .emit('match:timeout', { matchRequestId });
    }
  }

  private clearTimeout(matchRequestId: string): void {
    this.clearOfferTimeout(matchRequestId);
    const timer = this.patientTimers.get(matchRequestId);
    if (timer) {
      clearTimeout(timer);
      this.patientTimers.delete(matchRequestId);
    }
  }

  /** Sockets outlive bans and role changes, so each action re-reads the account (cached). */
  private async currentUser(client: Socket): Promise<any> {
    const status = await UserStatusCache.get(this.prisma, client.data.user.id);
    if (!status || accountBlockReason(status)) {
      throw new WsException('Account suspended');
    }
    client.data.user = { ...client.data.user, ...status };
    return client.data.user;
  }

  private async disconnectIfBlocked(userId: string): Promise<void> {
    try {
      const status = await UserStatusCache.get(this.prisma, userId);
      if (!status || accountBlockReason(status)) {
        this.server.in(`user:${userId}`).disconnectSockets(true);
      }
    } catch (err) {
      this.logger.error(
        `Status re-check failed for ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  private async getDoctorUserId(
    doctorProfileId: number,
  ): Promise<string | null> {
    return this.matchingService.getDoctorUserId(doctorProfileId);
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
      this.logger.warn(
        `Session extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      return null;
    }
  }
}
