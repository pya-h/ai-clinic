/**
 * LocalStorageProvider Unit Tests
 *
 * Tests:
 *   upload     — creates directory, writes file, returns url + key
 *   read       — streams existing file, null for missing file or directory
 *   delete     — deletes existing file, no-op for missing file
 *   getSignedUrl — returns public path
 *   keys escaping the base directory are rejected by every method
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { BadRequestException } from '@nestjs/common';
import { LocalStorageProvider } from './local-storage.provider';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
    provider = new LocalStorageProvider(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /* ── upload ── */

  describe('upload', () => {
    it('should write file and return url + key', async () => {
      const buffer = Buffer.from('hello world');
      const result = await provider.upload(
        buffer,
        'test.txt',
        'text/plain',
        'docs',
      );

      expect(result.key).toBe('docs/test.txt');
      expect(result.url).toBe('/uploads/docs/test.txt');

      // Verify file was actually written
      const written = await fs.readFile(path.join(testDir, 'docs', 'test.txt'));
      expect(written.toString()).toBe('hello world');
    });

    it('should create nested directories recursively', async () => {
      const buffer = Buffer.from('data');
      await provider.upload(buffer, 'img.jpg', 'image/jpeg', 'avatars');

      const stat = await fs.stat(path.join(testDir, 'avatars'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('should overwrite existing file with same name', async () => {
      const buffer1 = Buffer.from('first');
      const buffer2 = Buffer.from('second');

      await provider.upload(buffer1, 'file.txt', 'text/plain', 'docs');
      await provider.upload(buffer2, 'file.txt', 'text/plain', 'docs');

      const content = await fs.readFile(
        path.join(testDir, 'docs', 'file.txt'),
        'utf-8',
      );
      expect(content).toBe('second');
    });
  });

  /* ── read ── */

  describe('read', () => {
    it('should stream the stored file', async () => {
      const content = Buffer.from(randomUUID());
      const { key } = await provider.upload(
        content,
        `${randomUUID()}.png`,
        'image/png',
        'avatars',
      );

      const stream = await provider.read(key);

      expect(stream).not.toBeNull();
      expect(await readAll(stream!)).toEqual(content);
    });

    it('should return null for a missing file', async () => {
      await expect(
        provider.read(`avatars/${randomUUID()}.png`),
      ).resolves.toBeNull();
    });

    it('should return null when a path segment is a file', async () => {
      const { key } = await provider.upload(
        Buffer.from('x'),
        'f.png',
        'image/png',
        'avatars',
      );

      await expect(provider.read(`${key}/nested.png`)).resolves.toBeNull();
    });

    it('should return null for a directory', async () => {
      await provider.upload(Buffer.from('x'), 'f.png', 'image/png', 'avatars');

      await expect(provider.read('avatars')).resolves.toBeNull();
    });
  });

  /* ── path containment ── */

  describe('keys outside the base directory', () => {
    let siblingDir: string;

    beforeEach(async () => {
      // Shares the base directory's name as a prefix, e.g. /tmp/storage-test-abc-evil
      siblingDir = `${testDir}-evil`;
      await fs.mkdir(siblingDir);
      await fs.writeFile(path.join(siblingDir, 'secret.png'), 'secret');
    });

    afterEach(async () => {
      await fs.rm(siblingDir, { recursive: true, force: true });
    });

    const escapingKeys = () => [
      '../outside.png',
      `../${path.basename(siblingDir)}/secret.png`,
      path.join(siblingDir, 'secret.png'),
      '.',
    ];

    it('should reject them on read', async () => {
      for (const key of escapingKeys()) {
        await expect(provider.read(key)).rejects.toThrow(BadRequestException);
      }
    });

    it('should reject them on delete and leave the file in place', async () => {
      for (const key of escapingKeys()) {
        await expect(provider.delete(key)).rejects.toThrow(BadRequestException);
      }
      await expect(
        fs.readFile(path.join(siblingDir, 'secret.png'), 'utf-8'),
      ).resolves.toBe('secret');
    });

    it('should reject them on getSignedUrl', async () => {
      for (const key of escapingKeys()) {
        await expect(provider.getSignedUrl(key)).rejects.toThrow(
          BadRequestException,
        );
      }
    });

    it('should reject an escaping folder on upload without creating it', async () => {
      const folder = `../${path.basename(siblingDir)}/created`;

      await expect(
        provider.upload(Buffer.from('x'), 'f.png', 'image/png', folder),
      ).rejects.toThrow(BadRequestException);
      await expect(
        fs.access(path.join(siblingDir, 'created')),
      ).rejects.toThrow();
    });
  });

  /* ── delete ── */

  describe('delete', () => {
    it('should delete an existing file', async () => {
      const buffer = Buffer.from('to-delete');
      await provider.upload(buffer, 'rm-me.txt', 'text/plain', 'docs');

      await provider.delete('docs/rm-me.txt');

      await expect(
        fs.access(path.join(testDir, 'docs', 'rm-me.txt')),
      ).rejects.toThrow();
    });

    it('should not throw for a missing file', async () => {
      await expect(
        provider.delete('nonexistent/file.txt'),
      ).resolves.not.toThrow();
    });
  });

  /* ── getSignedUrl ── */

  describe('getSignedUrl', () => {
    it('should return the public URL path', async () => {
      const url = await provider.getSignedUrl('avatars/img.jpg');

      expect(url).toBe('/uploads/avatars/img.jpg');
    });
  });
});
