/**
 * FileUploadService Unit Tests
 *
 * Tests:
 *   uploadFile  — successful upload, invalid MIME type, missing file, large file
 *   deleteFile  — delegates to provider
 *   getFileUrl  — delegates to provider
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileUploadService } from './file-upload.service';

describe('FileUploadService', () => {
  let service: FileUploadService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        const config: Record<string, any> = {
          'storage.type': 'local',
          'storage.localPath': '/tmp/test-uploads',
        };
        return config[key] ?? defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileUploadService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FileUploadService>(FileUploadService);
  });

  afterEach(() => jest.clearAllMocks());

  /* ── helper to create a mock MultipartFile ── */
  function createMockFile(overrides: Partial<{
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }> = {}) {
    const buf = overrides.buffer ?? Buffer.from('fake-image-data');
    return {
      filename: overrides.filename ?? 'test-image.jpg',
      mimetype: overrides.mimetype ?? 'image/jpeg',
      encoding: '7bit',
      file: { bytesRead: buf.length },
      toBuffer: jest.fn().mockResolvedValue(buf),
      fields: {},
    } as any;
  }

  /* ── uploadFile ── */

  describe('uploadFile', () => {
    it('should upload a valid JPEG file', async () => {
      // Mock the internal provider's upload
      const providerSpy = jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: '/uploads/avatars/123-test.jpg', key: 'avatars/123-test.jpg' });

      const file = createMockFile();
      const result = await service.uploadFile(file, 'avatars');

      expect(result.url).toBe('/uploads/avatars/123-test.jpg');
      expect(result.fileName).toBe('test-image.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.key).toBe('avatars/123-test.jpg');
      expect(file.toBuffer).toHaveBeenCalled();
      expect(providerSpy).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/),
        'image/jpeg',
        'avatars',
      );
    });

    it('should upload a valid PNG file', async () => {
      jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: '/uploads/docs/123-doc.png', key: 'docs/123-doc.png' });

      const file = createMockFile({ filename: 'doc.png', mimetype: 'image/png' });
      const result = await service.uploadFile(file, 'docs');

      expect(result.mimeType).toBe('image/png');
    });

    it('should upload a valid PDF file', async () => {
      jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: '/uploads/docs/123-file.pdf', key: 'docs/123-file.pdf' });

      const file = createMockFile({ filename: 'file.pdf', mimetype: 'application/pdf' });
      const result = await service.uploadFile(file, 'docs');

      expect(result.mimeType).toBe('application/pdf');
    });

    it('should upload a valid WebP file', async () => {
      jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: '/uploads/avatars/123-img.webp', key: 'avatars/123-img.webp' });

      const file = createMockFile({ filename: 'img.webp', mimetype: 'image/webp' });
      const result = await service.uploadFile(file, 'avatars');

      expect(result.mimeType).toBe('image/webp');
    });

    it('should reject an invalid MIME type', async () => {
      const file = createMockFile({ mimetype: 'application/zip' });

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject a text file', async () => {
      const file = createMockFile({ mimetype: 'text/plain' });

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject when no file/mimetype provided', async () => {
      const file = { mimetype: null, toBuffer: jest.fn() } as any;

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject a file that exceeds 10MB', async () => {
      const bigBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const file = createMockFile({ buffer: bigBuffer });

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should sanitize filenames with special characters', async () => {
      const providerSpy = jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: '/uploads/avatars/123-file.jpg', key: 'avatars/123-file.jpg' });

      const file = createMockFile({ filename: 'my file (1).jpg' });
      await service.uploadFile(file, 'avatars');

      // The fileName passed to provider should be a UUID + extension
      const calledFileName = providerSpy.mock.calls[0][1];
      expect(calledFileName).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
    });
  });

  /* ── deleteFile ── */

  describe('deleteFile', () => {
    it('should delegate delete to the provider', async () => {
      const deleteSpy = jest
        .spyOn((service as any).provider, 'delete')
        .mockResolvedValue(undefined);

      await service.deleteFile('avatars/123-test.jpg');

      expect(deleteSpy).toHaveBeenCalledWith('avatars/123-test.jpg');
    });
  });

  /* ── getFileUrl ── */

  describe('getFileUrl', () => {
    it('should delegate getSignedUrl to the provider', async () => {
      const urlSpy = jest
        .spyOn((service as any).provider, 'getSignedUrl')
        .mockResolvedValue('/uploads/avatars/123-test.jpg');

      const url = await service.getFileUrl('avatars/123-test.jpg');

      expect(url).toBe('/uploads/avatars/123-test.jpg');
      expect(urlSpy).toHaveBeenCalledWith('avatars/123-test.jpg', undefined);
    });

    it('should pass expiresIn to the provider', async () => {
      const urlSpy = jest
        .spyOn((service as any).provider, 'getSignedUrl')
        .mockResolvedValue('signed-url');

      await service.getFileUrl('key', 3600);

      expect(urlSpy).toHaveBeenCalledWith('key', 3600);
    });
  });
});
