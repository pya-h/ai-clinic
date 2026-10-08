import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
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
    const key = `${folder}/${fileName}`;
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file);

    return { url: `/uploads/${key}`, key };
  }

  async read(key: string): Promise<Readable | null> {
    const filePath = this.resolveKey(key);
    try {
      if (!(await fs.stat(filePath)).isFile()) return null;
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
    return createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    this.resolveKey(key);
    return `/uploads/${key}`;
  }

  // The trailing separator matters: without it "uploads-evil/x" would pass as inside "uploads".
  private resolveKey(key: string): string {
    const base = path.resolve(this.basePath);
    const filePath = path.resolve(base, key);
    if (!filePath.startsWith(base + path.sep)) {
      throw new BadRequestException('Invalid file key.');
    }
    return filePath;
  }
}
