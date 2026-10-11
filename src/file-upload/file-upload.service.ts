import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Readable } from 'stream';
import { IStorageProvider } from './interfaces/storage-provider.interface';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { MultipartFile } from '@fastify/multipart';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export type UploadFolder = 'avatars' | 'doctor-documents';

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Applies to serving as well, so files stored before a type was dropped aren't served either.
const ALLOWED_MIME_TYPES: Record<UploadFolder, string[]> = {
  avatars: IMAGE_MIME_TYPES,
  'doctor-documents': [...IMAGE_MIME_TYPES, 'application/pdf'],
};

// Older uploads took their extension from the client's file name, hence '.jpeg' and any case.
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const STORED_FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
};

@Injectable()
export class FileUploadService {
  private readonly provider: IStorageProvider;
  private readonly logger = new Logger(FileUploadService.name);

  constructor(private readonly configService: ConfigService) {
    const storageType = this.configService.get<string>('storage.type', 'local');

    // Extensible: add 's3' case when S3StorageProvider is implemented
    if (storageType === 's3') {
      this.logger.warn(
        'S3 storage provider is not yet implemented — falling back to local storage.',
      );
    }

    const localPath = this.configService.get<string>(
      'storage.localPath',
      './uploads',
    );
    this.provider = new LocalStorageProvider(localPath);
  }

  /**
   * Upload a file after validating size and MIME type.
   */
  async uploadFile(
    file: MultipartFile,
    folder: UploadFolder,
  ): Promise<{ url: string; fileName: string; mimeType: string; key: string }> {
    this.validateFile(file, folder);

    const buffer = await file.toBuffer();

    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
    }

    this.verifyMagicBytes(buffer, file.mimetype);

    const fileName = `${randomUUID()}${EXTENSION_BY_MIME_TYPE[file.mimetype]}`;

    try {
      const { url, key } = await this.provider.upload(
        buffer,
        fileName,
        file.mimetype,
        folder,
      );

      return { url, fileName: file.filename, mimeType: file.mimetype, key };
    } catch (error) {
      this.logger.error(`File upload failed: ${error}`);
      throw new InternalServerErrorException('File upload failed.');
    }
  }

  /** Serves only the folder's allowed types; the content type is derived from the stored extension. */
  async openFile(
    folder: UploadFolder,
    fileName: string,
  ): Promise<{ stream: Readable; mimeType: string }> {
    const mimeType =
      MIME_TYPE_BY_EXTENSION[path.extname(fileName).toLowerCase()];
    if (
      !STORED_FILE_NAME.test(fileName) ||
      !ALLOWED_MIME_TYPES[folder].includes(mimeType)
    ) {
      throw new NotFoundException('File not found.');
    }

    const stream = await this.provider.read(`${folder}/${fileName}`);
    if (!stream) {
      throw new NotFoundException('File not found.');
    }
    return { stream, mimeType };
  }

  /**
   * Delete a file by its storage key.
   */
  async deleteFile(key: string): Promise<void> {
    return this.provider.delete(key);
  }

  /**
   * Delete a file that uploadFile stored in `folder`, given the URL it returned.
   * Any other URL (external, another folder, malformed) is left alone.
   */
  async deleteUploadedFile(folder: UploadFolder, url: string): Promise<void> {
    const prefix = `/uploads/${folder}/`;
    const fileName = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    if (STORED_FILE_NAME.test(fileName)) {
      await this.provider.delete(`${folder}/${fileName}`);
    }
  }

  /**
   * Get a URL for accessing a file (signed if needed).
   */
  async getFileUrl(key: string, expiresIn?: number): Promise<string> {
    return this.provider.getSignedUrl(key, expiresIn);
  }

  /**
   * Validate file MIME type before reading the full buffer.
   */
  private validateFile(file: MultipartFile, folder: UploadFolder): void {
    if (!file || !file.mimetype || !file.filename) {
      throw new BadRequestException('No file provided.');
    }

    const allowed = ALLOWED_MIME_TYPES[folder];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type '${file.mimetype}'. Allowed types: ${allowed.join(', ')}.`,
      );
    }
  }

  private verifyMagicBytes(buffer: Buffer, claimedMimeType: string): void {
    const signatures = MAGIC_BYTES[claimedMimeType];
    if (!signatures) return;

    for (const sig of signatures) {
      if (buffer.length < sig.offset + sig.bytes.length) {
        throw new BadRequestException(
          'File content does not match the declared file type.',
        );
      }
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[sig.offset + i] !== sig.bytes[i]) {
          throw new BadRequestException(
            'File content does not match the declared file type.',
          );
        }
      }
    }
  }
}
