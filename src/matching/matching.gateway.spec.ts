import { Test, TestingModule } from '@nestjs/testing';
import { MatchingGateway } from './matching.gateway';
import { MatchingService } from './matching.service';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { WsException } from '@nestjs/websockets';
import { DoctorSpecialtiesEnum, MatchStatusEnum } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatusCache } from '../auth/user-status';
import { captureHandshake, flushPromises } from '../../test/helpers/ws-handshake.helper';

describe('MatchingGateway', () => {
  let gateway: MatchingGateway;
  let matchingService: Record<string, jest.Mock>;
  let notificationService: Record<string, jest.Mock>;
  let prisma: { user: { findFirst: jest.Mock } };

  const statusFor = (userId: string, overrides: Record<string, unknown> = {}) => ({
    isActive: true,
    isBanned: false,
    banReason: null,
    role: userId === mockDoctor.id ? 'DOCTOR' : 'PATIENT',
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  });

  const mockPatient = {
    id: 'patient-1',
    firstname: 'Alice',
    lastname: 'Patient',
    isActive: true,
    role: 'PATIENT',
  };

  const mockDoctor = {
    id: 'doctor-1',
    firstname: 'Bob',
    lastname: 'Doctor',
    isActive: true,
    role: 'DOCTOR',
  };

  const createMockSocket = (user: any = mockPatient) => ({
    data: { user },
    id: 'socket-1',
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
  });

  const createMockServer = () => {
    const toEmit = jest.fn();
    const disconnectSockets = jest.fn();
    return {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit }),
      in: jest.fn().mockReturnValue({ socketsJoin: jest.fn(), disconnectSockets }),
      _toEmit: toEmit,
      _disconnectSockets: disconnectSockets,
    };
  };

  beforeEach(async () => {
    matchingService = {
      createMatchRequest: jest.fn(),
      acceptMatch: jest.fn(),
      rejectMatch: jest.fn(),
      cancelRequest: jest.fn(),
      matchDoctor: jest.fn().mockResolvedValue(undefined),
      timeoutRequest: jest.fn(),
      getDoctorUserId: jest.fn(),
    };

    notificationService = {
      onMatchFound: jest.fn().mockResolvedValue(undefined),
      onMatchAccepted: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      user: { findFirst: jest.fn(async ({ where }: any) => statusFor(where.id)) },
    };
    (UserStatusCache as any).entries.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingGateway,
        { provide: MatchingService, useValue: matchingService },
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

    gateway = module.get<MatchingGateway>(MatchingGateway);
    gateway.server = createMockServer() as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
    gateway.onModuleDestroy();
  });

  // ─── handleConnection ───

  describe('handleConnection', () => {
    it('should join user room on connection', async () => {
      const client = createMockSocket();

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith('user:patient-1');
    });

    it('should disconnect if no user data', async () => {
      const client = createMockSocket(null);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  // ─── handleDisconnect ───

  describe('handleDisconnect', () => {
    it('should leave user room', () => {
      const client = createMockSocket();

      gateway.handleDisconnect(client as any);

      expect(client.leave).toHaveBeenCalledWith('user:patient-1');
    });

    it('should do nothing if no user', () => {
      const client = createMockSocket(null);

      gateway.handleDisconnect(client as any);

      expect(client.leave).not.toHaveBeenCalled();
    });
  });

  // ─── handleMatchRequest ───

  describe('handleMatchRequest (match:request)', () => {
    it('should create match request and emit match:searching', async () => {
      const client = createMockSocket();
      const doctors = [
        { doctorId: 1, userId: 'doc-user-1', firstname: 'Dr', lastname: 'A' },
      ];
      matchingService.createMatchRequest.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        doctors,
      });

      await gateway.handleMatchRequest(client as any, {});

      expect(matchingService.createMatchRequest).toHaveBeenCalledWith(
        expect.objectContaining(mockPatient),
        undefined,
        undefined,
      );
      expect(client.emit).toHaveBeenCalledWith('match:searching', {
        matchRequestId: 'mr-1',
        candidates: 1,
      });
    });

    it('should pass soapId and specialty to service', async () => {
      const client = createMockSocket();
      matchingService.createMatchRequest.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        doctors: [],
      });

      await gateway.handleMatchRequest(client as any, {
        soapId: 'soap-1',
        specialty: DoctorSpecialtiesEnum.CARDIOLOGY,
      });

      expect(matchingService.createMatchRequest).toHaveBeenCalledWith(
        expect.objectContaining(mockPatient),
        'soap-1',
        DoctorSpecialtiesEnum.CARDIOLOGY,
      );
    });

    it('should reject invalid specialty', async () => {
      const client = createMockSocket();

      await gateway.handleMatchRequest(client as any, {
        specialty: 'INVALID_SPECIALTY',
      });

      expect(client.emit).toHaveBeenCalledWith(
        'match:error',
        expect.objectContaining({ message: expect.stringContaining('Invalid specialty') }),
      );
    });

    it('should throw WsException when user is missing', async () => {
      const client = createMockSocket(null);

      await expect(
        gateway.handleMatchRequest(client as any, {}),
      ).rejects.toThrow(WsException);
    });

    it('should emit match:error on service failure', async () => {
      const client = createMockSocket();
      matchingService.createMatchRequest.mockRejectedValue(
        new Error('already active'),
      );

      await gateway.handleMatchRequest(client as any, {});

      expect(client.emit).toHaveBeenCalledWith('match:error', {
        message: 'already active',
      });
    });

    it('should offer to top doctor when candidates exist', async () => {
      const client = createMockSocket();
      const doctors = [
        { doctorId: 1, userId: 'doc-u1', firstname: 'D1', lastname: 'L1' },
        { doctorId: 2, userId: 'doc-u2', firstname: 'D2', lastname: 'L2' },
      ];
      matchingService.createMatchRequest.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        doctors,
      });

      await gateway.handleMatchRequest(client as any, {});

      expect(matchingService.matchDoctor).toHaveBeenCalledWith('mr-1', 1);
      expect(gateway.server.to).toHaveBeenCalledWith('user:doc-u1');
    });
  });

  // ─── handleAccept ───

  describe('handleAccept (match:accept)', () => {
    it('should accept match and notify both parties', async () => {
      const client = createMockSocket(mockDoctor);
      matchingService.acceptMatch.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        consultationId: 'cons-1',
      });

      await gateway.handleAccept(client as any, { matchRequestId: 'mr-1' });

      expect(client.emit).toHaveBeenCalledWith('match:accepted', {
        matchRequestId: 'mr-1',
        consultationId: 'cons-1',
      });
      expect(gateway.server.to).toHaveBeenCalledWith('user:patient-1');
    });

    it('should throw WsException when matchRequestId is missing', async () => {
      const client = createMockSocket(mockDoctor);

      await expect(
        gateway.handleAccept(client as any, { matchRequestId: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should emit match:error on service failure', async () => {
      const client = createMockSocket(mockDoctor);
      matchingService.acceptMatch.mockRejectedValue(
        new Error('already accepted'),
      );

      await gateway.handleAccept(client as any, { matchRequestId: 'mr-1' });

      expect(client.emit).toHaveBeenCalledWith('match:error', {
        message: 'already accepted',
      });
    });
  });

  // ─── handleReject ───

  describe('handleReject (match:reject)', () => {
    it('should reject and offer to next doctor', async () => {
      const client = createMockSocket(mockDoctor);
      const nextDoctors = [
        { doctorId: 2, userId: 'doc-u2', firstname: 'D2', lastname: 'L2' },
      ];
      matchingService.rejectMatch.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        nextDoctors,
      });

      await gateway.handleReject(client as any, { matchRequestId: 'mr-1' });

      expect(client.emit).toHaveBeenCalledWith('match:rejected', {
        matchRequestId: 'mr-1',
      });
      expect(matchingService.matchDoctor).toHaveBeenCalledWith('mr-1', 2);
    });

    it('should timeout when no next doctors', async () => {
      const client = createMockSocket(mockDoctor);
      matchingService.rejectMatch.mockResolvedValue({
        matchRequest: { id: 'mr-1', patientId: 'patient-1' },
        nextDoctors: [],
      });
      matchingService.timeoutRequest.mockResolvedValue({
        id: 'mr-1',
        status: MatchStatusEnum.TIMEOUT,
      });

      await gateway.handleReject(client as any, { matchRequestId: 'mr-1' });

      expect(matchingService.timeoutRequest).toHaveBeenCalledWith('mr-1');
      expect(gateway.server.to).toHaveBeenCalledWith('user:patient-1');
    });

    it('should throw WsException when matchRequestId is missing', async () => {
      const client = createMockSocket(mockDoctor);

      await expect(
        gateway.handleReject(client as any, { matchRequestId: '' }),
      ).rejects.toThrow(WsException);
    });
  });

  // ─── handleCancel ───

  describe('handleCancel (match:cancel)', () => {
    it('should cancel request and notify patient', async () => {
      const client = createMockSocket();
      matchingService.cancelRequest.mockResolvedValue({
        id: 'mr-1',
        matchedDoctorId: null,
      });

      await gateway.handleCancel(client as any, { matchRequestId: 'mr-1' });

      expect(client.emit).toHaveBeenCalledWith('match:cancelled', {
        matchRequestId: 'mr-1',
      });
    });

    it('should notify matched doctor on cancel', async () => {
      const client = createMockSocket();
      matchingService.cancelRequest.mockResolvedValue({
        id: 'mr-1',
        matchedDoctorId: 5,
      });
      matchingService.getDoctorUserId.mockResolvedValue('doc-user-5');

      await gateway.handleCancel(client as any, { matchRequestId: 'mr-1' });

      expect(gateway.server.to).toHaveBeenCalledWith('user:doc-user-5');
    });

    it('should throw WsException when matchRequestId is missing', async () => {
      const client = createMockSocket();

      await expect(
        gateway.handleCancel(client as any, { matchRequestId: '' }),
      ).rejects.toThrow(WsException);
    });

    it('should emit match:error on service failure', async () => {
      const client = createMockSocket();
      matchingService.cancelRequest.mockRejectedValue(
        new Error('not found'),
      );

      await gateway.handleCancel(client as any, { matchRequestId: 'mr-1' });

      expect(client.emit).toHaveBeenCalledWith('match:error', {
        message: 'not found',
      });
    });
  });

  // ─── dispatchMatchRequest (shared WS + REST) ───

  describe('dispatchMatchRequest', () => {
    const MATCH_TIMEOUT_MS = 5 * 60 * 1000;

    const buildRequest = () => ({
      id: randomUUID(),
      patientId: randomUUID(),
      status: MatchStatusEnum.SEARCHING,
      matchedDoctorId: null,
    });

    const buildCandidate = () => ({
      doctorId: randomInt(1, 100_000),
      userId: randomUUID(),
      firstname: 'Dr',
      lastname: 'Candidate',
    });

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should offer to the top doctor and return the MATCHED request', async () => {
      const request = buildRequest();
      const [top, next] = [buildCandidate(), buildCandidate()];
      const matched = { ...request, status: MatchStatusEnum.MATCHED, matchedDoctorId: top.doctorId };
      matchingService.matchDoctor.mockResolvedValue(matched);

      const result = await gateway.dispatchMatchRequest(request as any, [top, next]);

      expect(result).toBe(matched);
      expect(matchingService.matchDoctor).toHaveBeenCalledTimes(1);
      expect(matchingService.matchDoctor).toHaveBeenCalledWith(request.id, top.doctorId);
      expect(gateway.server.to).toHaveBeenCalledWith(`user:${top.userId}`);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('match:request', {
        matchRequestId: request.id,
        doctorId: top.doctorId,
      });
      expect(notificationService.onMatchFound).toHaveBeenCalledWith(top.userId, request.id);
    });

    it('should return the request unchanged when there are no candidates', async () => {
      const request = buildRequest();

      const result = await gateway.dispatchMatchRequest(request as any, []);

      expect(result).toBe(request);
      expect(matchingService.matchDoctor).not.toHaveBeenCalled();
      expect(gateway.server.to).not.toHaveBeenCalled();
    });

    it('should time the request out after 5 minutes and notify the patient', async () => {
      const request = buildRequest();
      matchingService.timeoutRequest.mockResolvedValue({
        ...request,
        status: MatchStatusEnum.TIMEOUT,
      });

      await gateway.dispatchMatchRequest(request as any, []);

      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS - 1);
      expect(matchingService.timeoutRequest).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(matchingService.timeoutRequest).toHaveBeenCalledWith(request.id);
      expect(gateway.server.to).toHaveBeenCalledWith(`user:${request.patientId}`);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('match:timeout', {
        matchRequestId: request.id,
      });
    });

    it('should not notify the patient when the request was already resolved at timeout', async () => {
      const request = buildRequest();
      matchingService.timeoutRequest.mockResolvedValue({
        ...request,
        status: MatchStatusEnum.CONSULTATION_CREATED,
      });

      await gateway.dispatchMatchRequest(request as any, []);
      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS);

      expect(matchingService.timeoutRequest).toHaveBeenCalledWith(request.id);
      expect(gateway.server.to).not.toHaveBeenCalled();
    });

    it('should still start the timeout when the offer fails', async () => {
      const request = buildRequest();
      matchingService.matchDoctor.mockRejectedValue(new Error('status changed concurrently'));
      matchingService.timeoutRequest.mockResolvedValue({ ...request, status: MatchStatusEnum.TIMEOUT });

      await expect(
        gateway.dispatchMatchRequest(request as any, [buildCandidate()]),
      ).rejects.toThrow('status changed concurrently');

      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS);
      expect(matchingService.timeoutRequest).toHaveBeenCalledWith(request.id);
    });

    it('should replace (not orphan) a running timeout when dispatched again for the same request', async () => {
      const request = buildRequest();
      matchingService.timeoutRequest.mockResolvedValue({ ...request, status: MatchStatusEnum.TIMEOUT });

      await gateway.dispatchMatchRequest(request as any, []);
      await gateway.dispatchMatchRequest(request as any, []);
      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS);

      expect(matchingService.timeoutRequest).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should forget the timer once it has fired', async () => {
      const request = buildRequest();
      matchingService.timeoutRequest.mockResolvedValue({ ...request, status: MatchStatusEnum.TIMEOUT });

      await gateway.dispatchMatchRequest(request as any, []);
      expect((gateway as any).patientTimers.size).toBe(1);

      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS);
      expect((gateway as any).patientTimers.size).toBe(0);
    });

    it('should be used by the match:request WS handler (timeout armed with no candidates)', async () => {
      const client = createMockSocket();
      const request = { ...buildRequest(), patientId: mockPatient.id };
      matchingService.createMatchRequest.mockResolvedValue({ matchRequest: request, doctors: [] });
      matchingService.timeoutRequest.mockResolvedValue({ ...request, status: MatchStatusEnum.TIMEOUT });

      await gateway.handleMatchRequest(client as any, {});
      await jest.advanceTimersByTimeAsync(MATCH_TIMEOUT_MS);

      expect(matchingService.timeoutRequest).toHaveBeenCalledWith(request.id);
      expect(gateway.server.to).toHaveBeenCalledWith(`user:${mockPatient.id}`);
    });
  });

  // ─── notifyMatchCancelled (shared WS + REST) ───

  describe('notifyMatchCancelled', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clear the pending timeout of the request', async () => {
      const request = {
        id: randomUUID(),
        patientId: randomUUID(),
        status: MatchStatusEnum.SEARCHING,
        matchedDoctorId: null,
      };
      await gateway.dispatchMatchRequest(request as any, []);

      await gateway.notifyMatchCancelled({ ...request, status: MatchStatusEnum.CANCELLED } as any);
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(matchingService.timeoutRequest).not.toHaveBeenCalled();
    });

    it('should notify the offered doctor', async () => {
      const doctorProfileId = randomInt(1, 100_000);
      const doctorUserId = randomUUID();
      const matchRequestId = randomUUID();
      matchingService.getDoctorUserId.mockResolvedValue(doctorUserId);

      await gateway.notifyMatchCancelled({
        id: matchRequestId,
        status: MatchStatusEnum.CANCELLED,
        matchedDoctorId: doctorProfileId,
      } as any);

      expect(matchingService.getDoctorUserId).toHaveBeenCalledWith(doctorProfileId);
      expect(gateway.server.to).toHaveBeenCalledWith(`user:${doctorUserId}`);
      expect((gateway.server as any)._toEmit).toHaveBeenCalledWith('match:cancelled', {
        matchRequestId,
      });
    });

    it('should not emit when no doctor was offered', async () => {
      await gateway.notifyMatchCancelled({
        id: randomUUID(),
        status: MatchStatusEnum.CANCELLED,
        matchedDoctorId: null,
      } as any);

      expect(matchingService.getDoctorUserId).not.toHaveBeenCalled();
      expect(gateway.server.to).not.toHaveBeenCalled();
    });

    it('should not throw when the doctor lookup fails', async () => {
      matchingService.getDoctorUserId.mockRejectedValue(new Error('db down'));

      await expect(
        gateway.notifyMatchCancelled({
          id: randomUUID(),
          status: MatchStatusEnum.CANCELLED,
          matchedDoctorId: randomInt(1, 100_000),
        } as any),
      ).resolves.toBeUndefined();
      expect(gateway.server.to).not.toHaveBeenCalled();
    });
  });

  // ─── onModuleDestroy ───

  describe('onModuleDestroy', () => {
    it('should clear timers and destroy rate limiter without throwing', () => {
      expect(() => gateway.onModuleDestroy()).not.toThrow();
    });
  });

  // ─── Account status (bans, deactivation, role changes) ───

  describe('handshake account check', () => {
    let connect: ReturnType<typeof captureHandshake>;
    let sessionUser: any;

    beforeEach(() => {
      sessionUser = { ...mockPatient, id: randomUUID(), isBanned: false };
      jest.spyOn(gateway as any, 'extractUserFromSocket').mockImplementation(() => sessionUser);
      connect = captureHandshake(gateway);
    });

    it('should admit an active user with role and admin flags from the DB', async () => {
      prisma.user.findFirst.mockResolvedValue(statusFor(sessionUser.id, { role: 'DOCTOR' }));

      const { socket, next } = await connect();

      expect(next).toHaveBeenCalledWith();
      expect(socket.data.user).toMatchObject({ id: sessionUser.id, role: 'DOCTOR', isBanned: false });
    });

    it.each([
      ['banned', { isBanned: true, banReason: 'Spam' }, 'Unauthorized: Account banned'],
      ['deactivated', { isActive: false }, 'Unauthorized: Account deactivated'],
    ])('should reject a %s user whose session predates it', async (_label, dbState, message) => {
      prisma.user.findFirst.mockResolvedValue(statusFor(sessionUser.id, dbState));

      const { socket, next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error(message));
      expect(socket.data.user).toBeUndefined();
    });

    it('should admit a user unbanned since the session was issued', async () => {
      sessionUser = { ...sessionUser, isBanned: true };

      const { next } = await connect();

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject a session whose user no longer exists', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const { next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
    });

    it('should reject a connection without a session without querying the DB', async () => {
      sessionUser = null;

      const { next } = await connect();

      expect(next).toHaveBeenCalledWith(new Error('Unauthorized: No valid session'));
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
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

    it("should disconnect a user's open sockets once they are banned", async () => {
      const userId = randomUUID();
      prisma.user.findFirst.mockResolvedValue(statusFor(userId, { isBanned: true }));

      UserStatusCache.invalidate(userId);
      await flushPromises();

      expect(gateway.server.in).toHaveBeenCalledWith(`user:${userId}`);
      expect((gateway.server as any)._disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('should keep the sockets of a user whose change does not block them', async () => {
      const userId = randomUUID();
      prisma.user.findFirst.mockResolvedValue(statusFor(userId, { isAdmin: true }));

      UserStatusCache.invalidate(userId);
      await flushPromises();

      expect((gateway.server as any)._disconnectSockets).not.toHaveBeenCalled();
    });

    it('should survive a failed re-check', async () => {
      prisma.user.findFirst.mockRejectedValue(new Error('db down'));

      UserStatusCache.invalidate(randomUUID());
      await flushPromises();

      expect((gateway.server as any)._disconnectSockets).not.toHaveBeenCalled();
    });

    it('should stop watching once the module is destroyed', async () => {
      gateway.onModuleDestroy();

      UserStatusCache.invalidate(randomUUID());
      await flushPromises();

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('per-action account check', () => {
    it.each([
      ['match:request', (g: MatchingGateway, c: any) => g.handleMatchRequest(c, {})],
      ['match:accept', (g: MatchingGateway, c: any) => g.handleAccept(c, { matchRequestId: randomUUID() })],
      ['match:reject', (g: MatchingGateway, c: any) => g.handleReject(c, { matchRequestId: randomUUID() })],
      ['match:cancel', (g: MatchingGateway, c: any) => g.handleCancel(c, { matchRequestId: randomUUID() })],
    ])('should refuse %s from a user banned while connected', async (_event, act) => {
      const client = createMockSocket({ ...mockPatient, id: randomUUID() });
      prisma.user.findFirst.mockResolvedValue(statusFor(client.data.user.id, { isBanned: true }));

      await expect(act(gateway, client)).rejects.toThrow(new WsException('Account suspended'));
      for (const method of ['createMatchRequest', 'acceptMatch', 'rejectMatch', 'cancelRequest']) {
        expect(matchingService[method]).not.toHaveBeenCalled();
      }
    });

    it('should act with the role from the DB, not the one in the session', async () => {
      const client = createMockSocket({ ...mockPatient, id: randomUUID() });
      prisma.user.findFirst.mockResolvedValue(statusFor(client.data.user.id, { role: 'DOCTOR' }));
      matchingService.acceptMatch.mockResolvedValue({
        matchRequest: { id: randomUUID(), patientId: randomUUID() },
        consultationId: randomUUID(),
      });

      await gateway.handleAccept(client as any, { matchRequestId: randomUUID() });

      expect(matchingService.acceptMatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ id: client.data.user.id, role: 'DOCTOR' }),
      );
    });
  });
});
