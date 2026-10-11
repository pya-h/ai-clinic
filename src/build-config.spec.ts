import { existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/** `importers['.']` of pnpm-lock.yaml as name → specifier, per dependency section. */
function lockfileImporter(lockfile: string): Record<string, Record<string, string>> {
  // pnpm 11+ puts a separate document (the pinned package manager) first.
  const doc = lockfile
    .split(/^---$/m)
    .find((d) => /^ {4}(dependencies|devDependencies):$/m.test(d));
  if (!doc) throw new Error('No importer with dependencies in pnpm-lock.yaml');

  const sections: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | null = null;
  let name: string | null = null;
  for (const line of doc.slice(doc.indexOf('\n  .:\n') + 5).split('\n')) {
    if (/^ {0,2}\S/.test(line)) break;
    const sectionName = line.match(/^ {4}(\w+):$/)?.[1];
    if (sectionName) {
      section = sections[sectionName] = {};
      continue;
    }
    const dependency = line.match(/^ {6}'?([^':]+)'?:$/)?.[1];
    if (dependency) {
      name = dependency;
      continue;
    }
    const specifier = line.match(/^ {8}specifier: '?([^']+)'?$/)?.[1];
    if (specifier && section && name) section[name] = specifier;
  }
  return sections;
}

/** Whether a context path is excluded by .dockerignore (paths are relative to the context root). */
function dockerIgnored(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const glob = pattern
      .replace(/^\/|\/$/g, '')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${glob}(/.*)?$`).test(file);
  });
}

/**
 * The production entry point is only reachable if the build emits `src/main.ts`
 * where `start:prod` and the Docker CMD expect it.
 */
describe('build configuration', () => {
  const serverRoot = path.resolve(__dirname, '..');

  it.each(['package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json'])(
    'should have no %s next to pnpm-lock.yaml (pnpm is the package manager; another lockfile goes stale)',
    (lockfile) => {
      expect(existsSync(path.join(serverRoot, 'pnpm-lock.yaml'))).toBe(true);
      expect(existsSync(path.join(serverRoot, lockfile))).toBe(false);
    },
  );
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

  it('should run production under dumb-init, installed in that stage', () => {
    const dockerfile = read('Dockerfile');
    const production = dockerfile.slice(dockerfile.search(/^FROM .* AS production$/m));

    // Without an init process, `node` as PID 1 ignores SIGTERM and isn't reaped properly.
    expect(production).toMatch(/apt-get install[^\n]*\bdumb-init\b/);
    expect(production).toMatch(/^ENTRYPOINT \["dumb-init", "--"\]$/m);
  });

  it('should have a lockfile that agrees with package.json, or frozen installs fail', () => {
    const pkg = JSON.parse(read('package.json'));
    const importer = lockfileImporter(read('pnpm-lock.yaml'));

    expect(importer.dependencies).toEqual(pkg.dependencies);
    expect(importer.devDependencies ?? {}).toEqual(pkg.devDependencies ?? {});
  });

  it('should COPY only build-context files that exist and that .dockerignore keeps', () => {
    const ignore = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    const exists = (source: string) => {
      if (!source.includes('*')) return existsSync(path.join(serverRoot, source));
      const name = new RegExp(`^${path.basename(source).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
      return readdirSync(path.join(serverRoot, path.dirname(source))).some((f) => name.test(f));
    };
    const sources = read('Dockerfile')
      .split('\n')
      .filter((line) => /^COPY\s/.test(line) && !/--from=/.test(line))
      .flatMap((line) => line.split(/\s+/).slice(1, -1));

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect({ source, exists: exists(source), ignored: dockerIgnored(source, ignore) }).toEqual({
        source,
        exists: true,
        ignored: false,
      });
    }
  });

  describe('helpers', () => {
    it.each([
      ['node_modules', ['node_modules'], true],
      ['node_modules/a/b.js', ['node_modules'], true],
      ['a.spec.ts', ['*.spec.ts'], true],
      ['src/a.spec.ts', ['*.spec.ts'], false],
      ['src', ['*.spec.ts', 'test'], false],
      ['tests', ['test'], false],
      ['public', ['/public/'], true],
    ])('dockerIgnored(%s, %j) is %s', (file, patterns, expected) => {
      expect(dockerIgnored(file, patterns)).toBe(expected);
    });

    it('should read the importer, not the package-manager document before it', () => {
      const lockfile = [
        '---',
        'importers:',
        '  .:',
        '    packageManagerDependencies:',
        '      pnpm:',
        '        specifier: 12.0.0',
        '---',
        "lockfileVersion: '9.0'",
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        "      '@scope/a':",
        '        specifier: ^1.2.3',
        '        version: 1.2.4',
        '    devDependencies:',
        '      b:',
        "        specifier: '~2.0.0'",
        '        version: 2.0.1',
        '',
        'packages:',
      ].join('\n');

      expect(lockfileImporter(lockfile)).toEqual({
        dependencies: { '@scope/a': '^1.2.3' },
        devDependencies: { b: '~2.0.0' },
      });
    });
  });
});
