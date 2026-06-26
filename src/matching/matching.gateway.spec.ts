import { Test, TestingModule } from '@nestjs/testing';
import { MatchingGateway } from './matching.gateway';
import { MatchingService } from './matching.service';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { WsException } from '@nestjs/websockets';
import { DoctorSpecialtiesEnum, MatchStatusEnum } from '@prisma/client';

describe('MatchingGateway', () => {
  let gateway: MatchingGateway;
  let matchingService: Record<string, jest.Mock>;
  let notificationService: Record<string, jest.Mock>;

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
    return {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit }),
      in: jest.fn().mockReturnValue({ socketsJoin: jest.fn() }),
      _toEmit: toEmit,
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
        mockPatient,
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
        mockPatient,
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

  // ─── onModuleDestroy ───

  describe('onModuleDestroy', () => {
    it('should clear timers and destroy rate limiter without throwing', () => {
      expect(() => gateway.onModuleDestroy()).not.toThrow();
    });
  });
});
