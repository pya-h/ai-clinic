import { readFileSync } from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * The production entry point is only reachable if the build emits `src/main.ts`
 * where `start:prod` and the Docker CMD expect it.
 */
describe('build configuration', () => {
  const serverRoot = path.resolve(__dirname, '..');
  const read = (file: string) =>
    readFileSync(path.join(serverRoot, file), 'utf8');

  const parseBuildConfig = () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(serverRoot, 'tsconfig.build.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(String(d.messageText));
        },
      },
    );
    if (!parsed) throw new Error('tsconfig.build.json could not be parsed');
    return parsed;
  };

  const emittedEntry = () => {
    const parsed = parseBuildConfig();
    const outputs = ts.getOutputFileNames(
      parsed,
      path.join(serverRoot, 'src/main.ts'),
      false,
    );
    const js = outputs.find((file) => file.endsWith('.js'));
    return path.relative(serverRoot, js!).replace(/\.js$/, '');
  };

  it('should emit src/main.ts as dist/main.js', () => {
    expect(emittedEntry()).toBe(path.join('dist', 'main'));
  });

  it('should compile only files under src', () => {
    const outside = parseBuildConfig().fileNames.filter(
      (file) =>
        !path.resolve(file).startsWith(path.join(serverRoot, 'src') + path.sep),
    );

    expect(outside).toEqual([]);
  });

  it('should keep incremental build info inside dist, which `nest build` clears', () => {
    const { tsBuildInfoFile } = parseBuildConfig().options;

    expect(path.relative(serverRoot, tsBuildInfoFile!)).toBe(
      path.join('dist', 'tsconfig.build.tsbuildinfo'),
    );
  });

  it('should start production from the emitted entry point', () => {
    const entry = emittedEntry().split(path.sep).join('/');
    const { scripts } = JSON.parse(read('package.json'));
    const dockerCmd = read('Dockerfile')
      .split('\n')
      .find((line) => line.startsWith('CMD'));

    expect(scripts['start:prod']).toBe(`node ${entry}`);
    expect(dockerCmd).toContain(`node ${entry}"`);
  });

  it('should give every Docker pnpm install the build-script approvals', () => {
    const lines = read('Dockerfile').split('\n');
    const installs = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /pnpm install/.test(line));

    expect(installs.length).toBeGreaterThan(0);
    for (const { index } of installs) {
      const copiedBefore = lines
        .slice(0, index)
        .reverse()
        .find((line) => /^COPY\b.*package\.json/.test(line));
      expect(copiedBefore).toMatch(/\bpnpm-workspace\.yaml\b/);
    }
  });

  it('should install the Prisma CLI in production, matching @prisma/client', () => {
    const { dependencies, devDependencies } = JSON.parse(read('package.json'));

    // The production image runs `prisma generate` and `prisma migrate deploy` after `pnpm install --prod`.
    expect(dependencies.prisma).toBe(dependencies['@prisma/client']);
    expect(devDependencies.prisma).toBeUndefined();
  });

  it('should run production on a glibc image with libssl', () => {
    const dockerfile = read('Dockerfile');
    const production = dockerfile.slice(
      dockerfile.search(/^FROM .* AS production$/m),
    );

    // sodium-native has no musl prebuilds, and Prisma's engine needs libssl.
    expect(production).toMatch(/^FROM node:\S+ AS production$/m);
    expect(production.split('\n')[0]).not.toMatch(/alpine/);
    expect(production).toMatch(/apt-get install[^\n]*\bopenssl\b/);
  });
});
