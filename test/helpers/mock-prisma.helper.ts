/**
 * PrismaService mock factory for unit and E2E tests.
 * Creates a deep mock of PrismaService with all model delegates.
 */
export type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  doctorProfile: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  patientProfile: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  doctorReview: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
    count: jest.Mock;
  };
  chat: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  chatParticipant: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  message: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  aiConversation: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  patientSOAP: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
  };
  consultation: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  appointment: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  doctorAvailability: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  slotDuration: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  availabilityException: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  doctorDocument: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $connect: jest.Mock;
  $disconnect: jest.Mock;
};

export function createMockPrismaService(): MockPrismaService {
  const createModelMock = (extraMethods: string[] = []) => {
    const base: Record<string, jest.Mock> = {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    for (const method of extraMethods) {
      base[method] = jest.fn();
    }
    return base;
  };

  return {
    user: createModelMock(['count']) as any,
    doctorProfile: createModelMock(['count']) as any,
    patientProfile: createModelMock() as any,
    doctorReview: createModelMock(['aggregate', 'groupBy', 'count']) as any,
    chat: createModelMock(['count']) as any,
    chatParticipant: createModelMock() as any,
    message: createModelMock(['count']) as any,
    aiConversation: createModelMock() as any,
    patientSOAP: createModelMock(['upsert']) as any,
    consultation: createModelMock(['count']) as any,
    appointment: createModelMock(['count']) as any,
    doctorAvailability: createModelMock() as any,
    slotDuration: createModelMock() as any,
    availabilityException: createModelMock() as any,
    doctorDocument: createModelMock() as any,
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}
