/**
 * FileUploadService Unit Tests
 *
 * Tests:
 *   uploadFile  — successful upload, invalid MIME type, missing file, large file,
 *                 stored extension follows the MIME type, per-folder allowed types
 *   openFile    — content type from extension, rejects unsafe names and types the folder doesn't allow
 *   deleteFile  — delegates to provider
 *   deleteUploadedFile — deletes only URLs uploadFile produced for the folder
 *   getFileUrl  — delegates to provider
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { FileUploadService, UploadFolder } from './file-upload.service';

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

  const VALID_MAGIC: Record<string, Buffer> = {
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(20).fill(0)]),
    'image/webp': Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50,
      ...Array(12).fill(0),
    ]),
    'application/pdf': Buffer.from([
      0x25,
      0x50,
      0x44,
      0x46,
      ...Array(20).fill(0),
    ]),
  };

  /* ── helper to create a mock MultipartFile ── */
  function createMockFile(
    overrides: Partial<{
      filename: string;
      mimetype: string;
      buffer: Buffer;
    }> = {},
  ) {
    const mime = overrides.mimetype ?? 'image/jpeg';
    const buf =
      overrides.buffer ?? VALID_MAGIC[mime] ?? Buffer.from('fake-data');
    return {
      filename: overrides.filename ?? 'test-image.jpg',
      mimetype: mime,
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
        .mockResolvedValue({
          url: '/uploads/avatars/123-test.jpg',
          key: 'avatars/123-test.jpg',
        });

      const file = createMockFile();
      const result = await service.uploadFile(file, 'avatars');

      expect(result.url).toBe('/uploads/avatars/123-test.jpg');
      expect(result.fileName).toBe('test-image.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.key).toBe('avatars/123-test.jpg');
      expect(file.toBuffer).toHaveBeenCalled();
      expect(providerSpy).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
        ),
        'image/jpeg',
        'avatars',
      );
    });

    it('should upload a valid PNG file', async () => {
      jest.spyOn((service as any).provider, 'upload').mockResolvedValue({
        url: '/uploads/doctor-documents/123-doc.png',
        key: 'doctor-documents/123-doc.png',
      });

      const file = createMockFile({
        filename: 'doc.png',
        mimetype: 'image/png',
      });
      const result = await service.uploadFile(file, 'doctor-documents');

      expect(result.mimeType).toBe('image/png');
    });

    it('should upload a valid PDF file', async () => {
      jest.spyOn((service as any).provider, 'upload').mockResolvedValue({
        url: '/uploads/doctor-documents/123-file.pdf',
        key: 'doctor-documents/123-file.pdf',
      });

      const file = createMockFile({
        filename: 'file.pdf',
        mimetype: 'application/pdf',
      });
      const result = await service.uploadFile(file, 'doctor-documents');

      expect(result.mimeType).toBe('application/pdf');
    });

    it('should upload a valid WebP file', async () => {
      jest.spyOn((service as any).provider, 'upload').mockResolvedValue({
        url: '/uploads/avatars/123-img.webp',
        key: 'avatars/123-img.webp',
      });

      const file = createMockFile({
        filename: 'img.webp',
        mimetype: 'image/webp',
      });
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
      bigBuffer[0] = 0xff;
      bigBuffer[1] = 0xd8;
      bigBuffer[2] = 0xff;
      const file = createMockFile({ buffer: bigBuffer });

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject a file with spoofed MIME type', async () => {
      const pngBytes = VALID_MAGIC['image/png'];
      const file = createMockFile({ mimetype: 'image/jpeg', buffer: pngBytes });

      await expect(service.uploadFile(file, 'avatars')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should sanitize filenames with special characters', async () => {
      const providerSpy = jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({
          url: '/uploads/avatars/123-file.jpg',
          key: 'avatars/123-file.jpg',
        });

      const file = createMockFile({ filename: 'my file (1).jpg' });
      await service.uploadFile(file, 'avatars');

      // The fileName passed to provider should be a UUID + extension
      const calledFileName = providerSpy.mock.calls[0][1];
      expect(calledFileName).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
      );
    });
  });

  describe('uploadFile stored extension', () => {
    const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

    it.each([
      ['image/jpeg', 'photo.JPEG', '.jpg'],
      ['image/png', 'avatar.html', '.png'],
      ['image/webp', 'no-extension', '.webp'],
      ['application/pdf', 'license.pdf.exe', '.pdf'],
    ])(
      'should store %s uploaded as "%s" with the %s extension',
      async (mimetype, filename, ext) => {
        const providerSpy = jest
          .spyOn((service as any).provider, 'upload')
          .mockResolvedValue({ url: '/uploads/x', key: 'x' });

        const result = await service.uploadFile(
          createMockFile({ filename, mimetype }),
          'doctor-documents',
        );

        expect(providerSpy.mock.calls[0][1]).toMatch(
          new RegExp(`^${UUID}\\${ext}$`),
        );
        expect(result.fileName).toBe(filename);
      },
    );
  });

  describe('uploadFile allowed types per folder', () => {
    const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
    const cases: [UploadFolder, string, boolean][] = [
      ...IMAGES.map((m): [UploadFolder, string, boolean] => [
        'avatars',
        m,
        true,
      ]),
      ['avatars', 'application/pdf', false],
      ...IMAGES.map((m): [UploadFolder, string, boolean] => [
        'doctor-documents',
        m,
        true,
      ]),
      ['doctor-documents', 'application/pdf', true],
      ['doctor-documents', 'image/svg+xml', false],
      ['avatars', 'image/gif', false],
    ];

    it.each(cases)('%s: %s allowed = %s', async (folder, mimetype, allowed) => {
      const providerSpy = jest
        .spyOn((service as any).provider, 'upload')
        .mockResolvedValue({ url: `/uploads/${folder}/x`, key: `${folder}/x` });
      const file = createMockFile({ filename: `f-${randomUUID()}`, mimetype });

      const upload = service.uploadFile(file, folder);

      if (allowed) {
        await expect(upload).resolves.toMatchObject({ mimeType: mimetype });
        expect(providerSpy.mock.calls[0][3]).toBe(folder);
      } else {
        await expect(upload).rejects.toThrow(
          `Invalid file type '${mimetype}'. Allowed types: ${
            folder === 'avatars'
              ? IMAGES.join(', ')
              : [...IMAGES, 'application/pdf'].join(', ')
          }.`,
        );
        expect(file.toBuffer).not.toHaveBeenCalled();
        expect(providerSpy).not.toHaveBeenCalled();
      }
    });
  });

  /* ── openFile ── */

  describe('openFile', () => {
    const IMAGE_EXTENSIONS = [
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['JPG', 'image/jpeg'],
      ['webp', 'image/webp'],
    ];
    const cases: [UploadFolder, string, string][] = [
      ...IMAGE_EXTENSIONS.map(([e, m]): [UploadFolder, string, string] => [
        'avatars',
        e,
        m,
      ]),
      ...IMAGE_EXTENSIONS.map(([e, m]): [UploadFolder, string, string] => [
        'doctor-documents',
        e,
        m,
      ]),
      ['doctor-documents', 'pdf', 'application/pdf'],
      ['doctor-documents', 'PDF', 'application/pdf'],
    ];

    it.each(cases)(
      'should open a stored %s/*.%s file as %s',
      async (folder, ext, mimeType) => {
        const stream = Readable.from(['data']);
        const readSpy = jest
          .spyOn((service as any).provider, 'read')
          .mockResolvedValue(stream);
        const fileName = `${randomUUID()}.${ext}`;

        const result = await service.openFile(folder, fileName);

        expect(result).toEqual({ stream, mimeType });
        expect(readSpy).toHaveBeenCalledWith(`${folder}/${fileName}`);
      },
    );

    it.each(['pdf', 'PDF'])(
      'should not serve a .%s stored among avatars (e.g. uploaded before avatars were images only)',
      async (ext) => {
        const readSpy = jest.spyOn((service as any).provider, 'read');

        await expect(
          service.openFile('avatars', `${randomUUID()}.${ext}`),
        ).rejects.toThrow(NotFoundException);
        expect(readSpy).not.toHaveBeenCalled();
      },
    );

    it('should throw NotFoundException when the file does not exist', async () => {
      jest.spyOn((service as any).provider, 'read').mockResolvedValue(null);

      await expect(
        service.openFile('avatars', `${randomUUID()}.png`),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      `${randomUUID()}.html`,
      `${randomUUID()}.svg`,
      randomUUID(),
      '../secret.png',
      'nested/file.png',
      '..png',
      '',
    ])(
      'should not touch storage for the unsafe or unsupported name "%s"',
      async (fileName) => {
        const readSpy = jest.spyOn((service as any).provider, 'read');

        await expect(service.openFile('avatars', fileName)).rejects.toThrow(
          NotFoundException,
        );
        expect(readSpy).not.toHaveBeenCalled();
      },
    );
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

  /* ── deleteUploadedFile ── */

  describe('deleteUploadedFile', () => {
    it.each([
      ['avatars', `${randomUUID()}.png`],
      ['avatars', `${randomUUID()}.jpeg`],
      ['avatars', `${randomUUID()}.pdf`],
      ['doctor-documents', `${randomUUID()}.pdf`],
    ] as [UploadFolder, string][])(
      'should delete %s/%s given its upload URL',
      async (folder, fileName) => {
        const deleteSpy = jest
          .spyOn((service as any).provider, 'delete')
          .mockResolvedValue(undefined);

        await service.deleteUploadedFile(
          folder,
          `/uploads/${folder}/${fileName}`,
        );

        expect(deleteSpy).toHaveBeenCalledWith(`${folder}/${fileName}`);
      },
    );

    it.each([
      `https://cdn.example.com/${randomUUID()}.png`,
      `https://cdn.example.com/uploads/avatars/${randomUUID()}.png`,
      `/uploads/doctor-documents/${randomUUID()}.pdf`,
      `/uploads/avatarsX/${randomUUID()}.png`,
      `/uploads/avatars/../doctor-documents/${randomUUID()}.pdf`,
      `/uploads/avatars/nested/${randomUUID()}.png`,
      `/uploads/avatars/${randomUUID()}.png?v=1`,
      `/uploads/avatars/${randomUUID()}`,
      '/uploads/avatars/',
      `uploads/avatars/${randomUUID()}.png`,
      '',
    ])('should leave "%s" alone for avatars', async (url) => {
      const deleteSpy = jest.spyOn((service as any).provider, 'delete');

      await service.deleteUploadedFile('avatars', url);

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should propagate a storage failure', async () => {
      jest
        .spyOn((service as any).provider, 'delete')
        .mockRejectedValue(new Error('EACCES'));

      await expect(
        service.deleteUploadedFile(
          'avatars',
          `/uploads/avatars/${randomUUID()}.webp`,
        ),
      ).rejects.toThrow('EACCES');
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
