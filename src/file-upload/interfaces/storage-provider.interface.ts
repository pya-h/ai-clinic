export interface IStorageProvider {
  upload(
    file: Buffer,
    fileName: string,
    mimeType: string,
    folder: string,
  ): Promise<{ url: string; key: string }>;

  delete(key: string): Promise<void>;

  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}
