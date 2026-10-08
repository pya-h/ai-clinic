import { Readable } from 'stream';

export interface IStorageProvider {
  upload(
    file: Buffer,
    fileName: string,
    mimeType: string,
    folder: string,
  ): Promise<{ url: string; key: string }>;

  /** Resolves to null when the file does not exist. */
  read(key: string): Promise<Readable | null>;

  delete(key: string): Promise<void>;

  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}
