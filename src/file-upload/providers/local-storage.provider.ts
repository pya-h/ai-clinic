import * as fs from 'fs/promises';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { IStorageProvider } from '../interfaces/storage-provider.interface';

export class LocalStorageProvider implements IStorageProvider {
  private readonly basePath: string;

  constructor(localPath: string) {
    this.basePath = localPath || './uploads';
  }

  async upload(
    file: Buffer,
    fileName: string,
    _mimeType: string,
    folder: string,
  ): Promise<{ url: string; key: string }> {
    const dir = path.join(this.basePath, folder);
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, file);

    const key = `${folder}/${fileName}`;
    const url = `/uploads/${folder}/${fileName}`;

    return { url, key };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.resolve(this.basePath, key);
    if (!filePath.startsWith(path.resolve(this.basePath))) {
      throw new BadRequestException('Invalid file key.');
    }
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    const filePath = path.resolve(this.basePath, key);
    if (!filePath.startsWith(path.resolve(this.basePath))) {
      throw new BadRequestException('Invalid file key.');
    }
    return `/uploads/${key}`;
  }
}
