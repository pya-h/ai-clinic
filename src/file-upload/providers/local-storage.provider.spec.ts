/**
 * LocalStorageProvider Unit Tests
 *
 * Tests:
 *   upload     — creates directory, writes file, returns url + key
 *   delete     — deletes existing file, no-op for missing file
 *   getSignedUrl — returns public path
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageProvider } from './local-storage.provider';

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
      const result = await provider.upload(buffer, 'test.txt', 'text/plain', 'docs');

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

      const content = await fs.readFile(path.join(testDir, 'docs', 'file.txt'), 'utf-8');
      expect(content).toBe('second');
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
      await expect(provider.delete('nonexistent/file.txt')).resolves.not.toThrow();
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
