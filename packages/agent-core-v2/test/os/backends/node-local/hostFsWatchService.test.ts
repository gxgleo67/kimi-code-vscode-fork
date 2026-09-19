import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetUnexpectedErrorHandler,
  setUnexpectedErrorHandler,
} from '#/_base/errors/unexpectedError';
import { HostFsWatchService } from '#/os/backends/node-local/hostFsWatchService';
import type {
  HostFsChange,
  IHostFsWatchHandle,
  IHostFsWatchService,
} from '#/os/interface/hostFsWatch';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const longTempDir = (prefix: string): Promise<string> =>
  mkdtemp(join(realpathSync.native(tmpdir()), prefix));

type HostFsWatchRuntime = NonNullable<ConstructorParameters<typeof HostFsWatchService>[0]>;

class TestNativeWatcher {
  private errorListener: ((error: NodeJS.ErrnoException) => void) | undefined;
  closed = false;

  on(_event: 'error', listener: (error: NodeJS.ErrnoException) => void): this {
    this.errorListener = listener;
    return this;
  }

  close(): void {
    this.closed = true;
  }

  fail(code = 'EIO'): void {
    this.errorListener?.(Object.assign(new Error('native watch failed'), { code }));
  }
}

interface TestNativeAttempt {
  readonly root: string;
  readonly watcher: TestNativeWatcher;
  emit(filename: string | null): void;
}

interface TestRetry {
  readonly delayMs: number;
  readonly active: boolean;
  run(): void;
}

function signalRig(options?: {
  readonly synchronousFailures?: number;
  readonly platform?: NodeJS.Platform;
  readonly resolvePath?: (path: string) => string;
}): {
  readonly service: IHostFsWatchService;
  readonly attempts: TestNativeAttempt[];
  readonly retries: TestRetry[];
  attempt(index: number): TestNativeAttempt;
  retry(index: number): TestRetry;
} {
  const attempts: TestNativeAttempt[] = [];
  const retries: TestRetry[] = [];
  let synchronousFailures = options?.synchronousFailures ?? 0;
  const runtime: HostFsWatchRuntime = {
    platform: options?.platform ?? 'darwin',
    resolvePath: options?.resolvePath,
    watchNative: (root, listener) => {
      if (synchronousFailures > 0) {
        synchronousFailures -= 1;
        throw Object.assign(new Error('native watch creation failed'), { code: 'EIO' });
      }
      const watcher = new TestNativeWatcher();
      attempts.push({
        root,
        watcher,
        emit: (filename) => {
          listener('rename', filename);
        },
      });
      return watcher;
    },
    scheduleRetry: (callback, delayMs) => {
      let active = true;
      retries.push({
        delayMs,
        get active() {
          return active;
        },
        run: () => {
          if (!active) return;
          active = false;
          callback();
        },
      });
      return {
        dispose: () => {
          active = false;
        },
      };
    },
  };
  return {
    service: new HostFsWatchService(runtime),
    attempts,
    retries,
    attempt: (index) => requiredAt(attempts, index),
    retry: (index) => requiredAt(retries, index),
  };
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`missing test value at index ${index}`);
  return value;
}

describe('host filesystem change notifications', () => {
  let root: string;
  let handle: IHostFsWatchHandle | undefined;

  beforeEach(() => {
    setUnexpectedErrorHandler(() => undefined);
  });

  afterEach(async () => {
    handle?.dispose();
    handle = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
    resetUnexpectedErrorHandler();
  });

  async function start(recursive = true): Promise<HostFsChange[]> {
    const events: HostFsChange[] = [];
    const svc = new HostFsWatchService();
    handle = svc.watch(root, { recursive });
    handle.onDidChange((e) => events.push(e));
    await handle.ready;
    return events;
  }

  async function startSignal(ignored?: (path: string) => boolean): Promise<HostFsChange[]> {
    const events: HostFsChange[] = [];
    const svc = new HostFsWatchService();
    handle = svc.watch(root, { recursive: true, signal: true, ignored });
    handle.onDidChange((e) => events.push(e));
    await handle.ready;
    return events;
  }

  it('emits a coarse root invalidation when a native signal path changes', () => {
    const rig = signalRig();
    const events: HostFsChange[] = [];
    handle = rig.service.watch('/repo', { signal: true });
    handle.onDidChange((event) => events.push(event));

    rig.attempt(0).emit('skills/demo/SKILL.md');

    expect(events).toEqual([{ path: '/repo', action: 'modified', kind: 'directory' }]);
  });

  it('does not invalidate when a native signal path is ignored', () => {
    const rig = signalRig();
    const events: HostFsChange[] = [];
    handle = rig.service.watch('/repo', {
      signal: true,
      ignored: (path) => path.includes('node_modules'),
    });
    handle.onDidChange((event) => events.push(event));

    rig.attempt(0).emit('node_modules/pkg/index.js');

    expect(events).toEqual([]);
  });

  it('watches the resolved root and reports changes under the requested path', () => {
    const rig = signalRig({
      platform: 'win32',
      resolvePath: (path) => path.replace('/RUNNER~1/', '/runneradmin/'),
    });
    const events: HostFsChange[] = [];
    const ignoredPaths: string[] = [];
    handle = rig.service.watch('/Users/RUNNER~1/repo', {
      signal: true,
      ignored: (path) => {
        ignoredPaths.push(path);
        return path.includes('node_modules');
      },
    });
    handle.onDidChange((event) => events.push(event));

    rig.attempt(0).emit('node_modules/pkg/index.js');
    rig.attempt(0).emit('src/index.ts');

    expect(rig.attempt(0).root).toBe('/Users/runneradmin/repo');
    expect(ignoredPaths).toEqual([
      join('/Users/RUNNER~1/repo', 'node_modules/pkg/index.js'),
      join('/Users/RUNNER~1/repo', 'src/index.ts'),
    ]);
    expect(events).toEqual([
      { path: '/Users/RUNNER~1/repo', action: 'modified', kind: 'directory' },
    ]);
  });

  it('does not invalidate when an ignored native signal path is a child starting with two dots', () => {
    const rig = signalRig();
    const events: HostFsChange[] = [];
    handle = rig.service.watch('/repo', {
      signal: true,
      ignored: (path) => path.includes('..cache'),
    });
    handle.onDidChange((event) => events.push(event));

    rig.attempt(0).emit(join('..cache', 'index.json'));

    expect(events).toEqual([]);
  });

  it('maps resolved children starting with two dots back to the requested path', () => {
    const rig = signalRig({
      platform: 'win32',
      resolvePath: (path) => path.replace('/RUNNER~1/', '/runneradmin/'),
    });
    const ignoredPaths: string[] = [];
    handle = rig.service.watch('/Users/RUNNER~1/repo', {
      signal: true,
      ignored: (path) => {
        ignoredPaths.push(path);
        return false;
      },
    });

    rig.attempt(0).emit(join('..cache', 'index.json'));

    expect(ignoredPaths).toEqual([join('/Users/RUNNER~1/repo', '..cache/index.json')]);
  });

  it('increases the retry delay after consecutive native failures', () => {
    const rig = signalRig();
    handle = rig.service.watch('/repo', { signal: true });

    rig.attempt(0).watcher.fail();
    rig.retry(0).run();
    rig.attempt(1).watcher.fail();
    rig.retry(1).run();
    rig.attempt(2).watcher.fail();

    expect(rig.retries.map((retry) => retry.delayMs)).toEqual([1000, 2000, 4000]);
  });

  it('invalidates again after a native watch is rearmed', () => {
    const rig = signalRig();
    const events: HostFsChange[] = [];
    handle = rig.service.watch('/repo', { signal: true });
    handle.onDidChange((event) => events.push(event));

    rig.attempt(0).watcher.fail();
    rig.retry(0).run();

    expect(events).toEqual([
      { path: '/repo', action: 'modified', kind: 'directory' },
      { path: '/repo', action: 'modified', kind: 'directory' },
    ]);
  });

  it('invalidates after recovering from a synchronous native-watch creation failure', () => {
    const rig = signalRig({ synchronousFailures: 1 });
    const events: HostFsChange[] = [];
    handle = rig.service.watch('/repo', { signal: true });
    handle.onDidChange((event) => events.push(event));

    rig.retry(0).run();

    expect(rig.attempts).toHaveLength(1);
    expect(events).toEqual([{ path: '/repo', action: 'modified', kind: 'directory' }]);
  });

  it('resets the retry delay after the recovered native watch emits an event', () => {
    const rig = signalRig();
    handle = rig.service.watch('/repo', { signal: true });

    rig.attempt(0).watcher.fail();
    rig.retry(0).run();
    rig.attempt(1).emit('skills/demo/SKILL.md');
    rig.attempt(1).watcher.fail();

    expect(rig.retries.map((retry) => retry.delayMs)).toEqual([1000, 1000]);
  });

  it('cancels a pending native retry when the watch handle is disposed', () => {
    const rig = signalRig();
    handle = rig.service.watch('/repo', { signal: true });
    rig.attempt(0).watcher.fail();

    handle.dispose();
    handle = undefined;
    rig.retry(0).run();

    expect(rig.retry(0).active).toBe(false);
    expect(rig.attempt(0).watcher.closed).toBe(true);
    expect(rig.attempts).toHaveLength(1);
  });

  it('reports create / modify / delete for a file', async () => {
    root = await longTempDir('hostfswatch-');
    const events = await start();

    const file = join(root, 'a.txt');
    await writeFile(file, 'v1');
    await wait(300);
    await writeFile(file, 'v2');
    await wait(300);
    await rm(file);
    await wait(300);

    const actions = events.filter((e) => e.path === file).map((e) => e.action);
    expect(actions).toContain('created');
    expect(actions).toContain('modified');
    expect(actions).toContain('deleted');
    expect(events.find((e) => e.path === file)?.kind).toBe('file');
  });

  it('does not fire for paths ignored by default (.git)', async () => {
    root = await longTempDir('hostfswatch-');
    const events = await start();

    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), 'x');
    await wait(300);

    expect(events.some((e) => e.path.includes('/.git/') || e.path.endsWith('/.git'))).toBe(false);
  });

  it('does not fire for pre-existing files (ignoreInitial)', async () => {
    root = await longTempDir('hostfswatch-');
    const preexisting = join(root, 'pre.txt');
    await writeFile(preexisting, 'v0');

    const events = await start();
    await wait(300);

    expect(events.some((e) => e.path === preexisting)).toBe(false);
  });

  it('stops firing after the handle is disposed', async () => {
    root = await longTempDir('hostfswatch-');
    const events = await start();

    handle?.dispose();
    handle = undefined;

    await writeFile(join(root, 'after-dispose.txt'), 'x');
    await wait(300);

    expect(events).toHaveLength(0);
  });

  it('reports chokidar changes under the requested path when the watched root resolves elsewhere', async () => {
    const base = await longTempDir('hostfswatch-resolved-');
    const target = join(base, 'long-name');
    const requested = join(base, 'LONG~1');
    await mkdir(target);
    await symlink(target, requested, 'junction');
    const resolvedTarget = await realpath(target);
    const service = new HostFsWatchService({
      platform: 'win32',
      resolvePath: (path) => (path === requested ? resolvedTarget : path),
      watchNative: () => {
        throw new Error('native watch must not be used without signal mode');
      },
      scheduleRetry: () => ({ dispose: () => {} }),
    });
    const events: HostFsChange[] = [];
    const ignoredPaths: string[] = [];
    try {
      handle = service.watch(requested, {
        recursive: false,
        ignored: (path) => {
          ignoredPaths.push(path);
          return false;
        },
      });
      handle.onDidChange((event) => events.push(event));
      await handle.ready;

      await writeFile(join(target, 'config.toml'), 'x');

      await expect
        .poll(() => events.some((e) => e.path === join(requested, 'config.toml') && e.action === 'created'))
        .toBe(true);
      expect(events.every((e) => e.path.startsWith(requested))).toBe(true);
      expect(ignoredPaths.every((path) => path.startsWith(requested))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'reports changes under an 8.3 short path on Windows',
    async () => {
      root = await mkdtemp(join(tmpdir(), 'hostfswatch-'));
      const long = join(root, 'long directory name');
      await mkdir(long);
      const short = execFileSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${long}") do @echo %~sI"`], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      } as ExecFileSyncOptionsWithStringEncoding).trim();
      expect(basename(short)).toMatch(/~\d/);
      expect(existsSync(short)).toBe(true);
      await writeFile(join(long, 'config.toml'), 'v1');
      const events: HostFsChange[] = [];
      handle = new HostFsWatchService().watch(short, { recursive: false });
      handle.onDidChange((e) => events.push(e));
      await handle.ready;

      await writeFile(join(long, 'config.toml'), 'v2');
      await writeFile(join(long, 'added.toml'), 'v1');

      await expect
        .poll(() => events, { timeout: 10000 })
        .toEqual(
          expect.arrayContaining([
            { path: join(short, 'config.toml'), action: 'modified', kind: 'file' },
            { path: join(short, 'added.toml'), action: 'created', kind: 'file' },
          ]),
        );
    },
    30000,
  );

  it.skipIf(process.platform !== 'darwin')(
    'signal mode keeps the fd footprint bounded on a fat subtree',
    async () => {
      root = await longTempDir('hostfswatch-fat-');
      const fat = join(root, 'fat');
      await mkdir(fat, { recursive: true });
      for (let i = 0; i < 1200; i++) {
        await writeFile(join(fat, `f${i}.txt`), 'x');
      }

      const fdsBefore = readdirSync('/dev/fd').length;
      await startSignal();
      const fdsAfter = readdirSync('/dev/fd').length;

      expect(fdsAfter - fdsBefore).toBeLessThan(50);
    },
    30000,
  );
});
