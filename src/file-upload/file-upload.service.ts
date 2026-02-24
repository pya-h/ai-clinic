import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from './interfaces/storage-provider.interface';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { MultipartFile } from '@fastify/multipart';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class FileUploadService {
  private readonly provider: IStorageProvider;

  constructor(private readonly configService: ConfigService) {
    const storageType = this.configService.get<string>('storage.type', 'local');

    // Extensible: add 's3' case when S3StorageProvider is implemented
    if (storageType === 's3') {
      // TODO: new S3StorageProvider(configService)
      throw new Error('S3 storage provider is not yet implemented.');
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
    folder: string,
  ): Promise<{ url: string; fileName: string; mimeType: string; key: string }> {
    this.validateFile(file);

    const buffer = await file.toBuffer();

    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
    }

    const safeOriginalName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}-${safeOriginalName}`;

    const { url, key } = await this.provider.upload(
      buffer,
      fileName,
      file.mimetype,
      folder,
    );

    return { url, fileName: file.filename, mimeType: file.mimetype, key };
  }

  /**
   * Delete a file by its storage key.
   */
  async deleteFile(key: string): Promise<void> {
    return this.provider.delete(key);
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
  private validateFile(file: MultipartFile): void {
    if (!file || !file.mimetype) {
      throw new BadRequestException('No file provided.');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type '${file.mimetype}'. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}.`,
      );
    }
  }
}
