import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { FileUploadController } from './file-upload.controller';
import { FileUploadService } from './file-upload.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FileUploadController', () => {
  let controller: FileUploadController;
  let fileUploadService: { openFile: jest.Mock };
  let prisma: { doctorDocument: { findFirst: jest.Mock } };
  let reply: { header: jest.Mock };

  const buildUser = (overrides: Record<string, unknown> = {}) =>
    ({
      id: randomUUID(),
      isAdmin: false,
      isSuperAdmin: false,
      ...overrides,
    }) as any;

  beforeEach(async () => {
    fileUploadService = {
      openFile: jest.fn().mockResolvedValue({
        stream: Readable.from(['data']),
        mimeType: 'image/png',
      }),
    };
    prisma = { doctorDocument: { findFirst: jest.fn() } };
    reply = { header: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileUploadController],
      providers: [
        { provide: FileUploadService, useValue: fileUploadService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get(FileUploadController);
  });

  describe('getAvatar', () => {
    it('should stream the avatar with a cross-origin resource policy', async () => {
      const fileName = `${randomUUID()}.png`;

      const result = await controller.getAvatar(fileName, reply as any);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(result.options.type).toBe('image/png');
      expect(fileUploadService.openFile).toHaveBeenCalledWith(
        'avatars',
        fileName,
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Cross-Origin-Resource-Policy',
        'cross-origin',
      );
    });

    it('should propagate NotFoundException for a missing avatar', async () => {
      fileUploadService.openFile.mockRejectedValue(
        new NotFoundException('File not found.'),
      );

      await expect(
        controller.getAvatar(`${randomUUID()}.png`, reply as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDoctorDocument', () => {
    const fileName = `${randomUUID()}.pdf`;
    const ownerUserId = randomUUID();

    beforeEach(() => {
      prisma.doctorDocument.findFirst.mockResolvedValue({
        doctor: { userId: ownerUserId },
      });
      fileUploadService.openFile.mockResolvedValue({
        stream: Readable.from(['%PDF']),
        mimeType: 'application/pdf',
      });
    });

    it('should look the document up by its stored URL', async () => {
      await controller.getDoctorDocument(
        fileName,
        buildUser({ id: ownerUserId }),
        reply as any,
      );

      expect(prisma.doctorDocument.findFirst).toHaveBeenCalledWith({
        where: { fileUrl: `/uploads/doctor-documents/${fileName}` },
        select: { doctor: { select: { userId: true } } },
      });
    });

    it.each([
      ['the owning doctor', { id: ownerUserId }],
      ['an admin', { isAdmin: true }],
      ['a super admin', { isSuperAdmin: true }],
    ])(
      'should stream the document to %s without caching',
      async (_label, overrides) => {
        const result = await controller.getDoctorDocument(
          fileName,
          buildUser(overrides),
          reply as any,
        );

        expect(result).toBeInstanceOf(StreamableFile);
        expect(result.options.type).toBe('application/pdf');
        expect(fileUploadService.openFile).toHaveBeenCalledWith(
          'doctor-documents',
          fileName,
        );
        expect(reply.header).toHaveBeenCalledWith(
          'Cache-Control',
          'private, no-store',
        );
      },
    );

    it('should forbid any other user without reading the file', async () => {
      await expect(
        controller.getDoctorDocument(fileName, buildUser(), reply as any),
      ).rejects.toThrow(ForbiddenException);
      expect(fileUploadService.openFile).not.toHaveBeenCalled();
    });

    it('should return 404 for a file with no document record, even for admins', async () => {
      prisma.doctorDocument.findFirst.mockResolvedValue(null);

      await expect(
        controller.getDoctorDocument(
          fileName,
          buildUser({ isAdmin: true }),
          reply as any,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(fileUploadService.openFile).not.toHaveBeenCalled();
    });
  });
});
