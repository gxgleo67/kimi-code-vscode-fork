import { watch as fsWatch, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import { FSWatcher } from 'chokidar';

import type { IDisposable } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { onUnexpectedError } from '#/_base/errors/unexpectedError';

import {
  type HostFsChange,
  type HostFsChangeAction,
  type HostFsChangeKind,
  type HostFsWatchOptions,
  type IHostFsWatchHandle,
  IHostFsWatchService,
  isHostFsWatchEnabled,
} from '#/os/interface/hostFsWatch';

const DEFAULT_IGNORED = (p: string): boolean => /(?:^|[/\\])\.git(?:$|[/\\])/.test(p);

const NATIVE_RETRY_BASE_MS = 1000;
const NATIVE_RETRY_MAX_MS = 30000;

interface NativeFsWatcher {
  close(): void;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
}

interface HostFsWatchRuntime {
  readonly platform: NodeJS.Platform;
  readonly resolvePath?: (path: string) => string;
  watchNative(
    root: string,
    listener: (eventType: string, filename: string | null) => void,
  ): NativeFsWatcher;
  scheduleRetry(callback: () => void, delayMs: number): IDisposable;
}

const NODE_HOST_FS_WATCH_RUNTIME: HostFsWatchRuntime = {
  platform: process.platform,
  resolvePath: (path) =>
    process.platform === 'win32' && /~\d/.test(path) ? resolveLongPath(path) : path,
  watchNative: (root, listener) =>
    fsWatch(root, { persistent: false, recursive: true }, listener),
  scheduleRetry: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return {
      dispose: () => {
        clearTimeout(timer);
      },
    };
  },
};

interface WatchReadiness {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function createWatchReadiness(): WatchReadiness {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
    reject: (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

class HostFsWatchHandle implements IHostFsWatchHandle {
  readonly ready: Promise<void>;
  readonly onDidChange: Event<HostFsChange>;

  private readonly readiness = createWatchReadiness();
  private readonly emitter: Emitter<HostFsChange>;
  private readonly watcher: FSWatcher;
  private disposed = false;

  constructor(
    path: string,
    options: HostFsWatchOptions | undefined,
    private readonly toRequestedPath: (path: string) => string = (p) => p,
  ) {
    this.ready = this.readiness.promise;
    this.emitter = new Emitter<HostFsChange>();
    this.onDidChange = this.emitter.event;
    this.watcher = new FSWatcher({
      ignoreInitial: true,
      persistent: false,
      followSymlinks: false,
      depth: options?.recursive === false ? 0 : undefined,
      ignored: options?.ignored ?? DEFAULT_IGNORED,
    });
    this.watcher.on('all', (eventName: string, absPath: string) => {
      const mapped = mapChokidarEvent(eventName, this.toRequestedPath(absPath));
      if (mapped !== undefined) this.emitter.fire(mapped);
    });
    this.watcher.on('error', (error: unknown) => {
      this.readiness.reject(error);
      onUnexpectedError(error);
    });
    this.watcher.once('ready', () => this.readiness.resolve());
    this.watcher.add(path);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readiness.resolve();
    void this.watcher.close().catch(() => undefined);
    this.emitter.dispose();
  }
}

class SignalWatchHandle implements IHostFsWatchHandle {
  readonly ready: Promise<void>;
  readonly onDidChange: Event<HostFsChange>;

  private readonly readiness = createWatchReadiness();
  private readonly emitter: Emitter<HostFsChange>;
  private readonly ignored: (path: string) => boolean;
  private nativeWatcher: NativeFsWatcher | undefined;
  private chokidarLeg: HostFsWatchHandle | undefined;
  private retry: IDisposable | undefined;
  private retryAttempts = 0;
  private recovering = false;
  private disposed = false;

  constructor(
    private readonly root: string,
    options: HostFsWatchOptions | undefined,
    private readonly runtime: HostFsWatchRuntime,
    private readonly toRequestedPath: (path: string) => string,
  ) {
    this.ready = this.readiness.promise;
    this.emitter = new Emitter<HostFsChange>();
    this.onDidChange = this.emitter.event;
    this.ignored = options?.ignored ?? DEFAULT_IGNORED;
    this.startNativeLeg();
  }

  private startNativeLeg(): void {
    if (this.disposed) return;
    try {
      const watcher = this.runtime.watchNative(this.root, (_eventType, filename) => {
        if (this.disposed) return;
        this.retryAttempts = 0;
        const absPath = resolveNativeSignalPath(this.root, filename);
        if (absPath !== this.root && this.ignored(absPath)) return;
        this.fireInvalidation();
      });
      watcher.on('error', (error: NodeJS.ErrnoException) => {
        this.onNativeError(watcher, error);
      });
      this.nativeWatcher = watcher;
      this.readiness.resolve();
      if (this.recovering) {
        this.recovering = false;
        this.fireInvalidation();
      }
    } catch (error) {
      this.onNativeError(undefined, error as NodeJS.ErrnoException);
    }
  }

  private onNativeError(watcher: NativeFsWatcher | undefined, error: NodeJS.ErrnoException): void {
    if (this.disposed) return;
    if (watcher !== undefined && watcher !== this.nativeWatcher) return;
    watcher?.close();
    this.nativeWatcher = undefined;
    if (error.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      this.recovering = false;
      this.startChokidarLeg();
      this.fireInvalidation();
      return;
    }
    onUnexpectedError(error);
    this.recovering = true;
    this.fireInvalidation();
    const delay = Math.min(NATIVE_RETRY_BASE_MS * 2 ** this.retryAttempts, NATIVE_RETRY_MAX_MS);
    this.retryAttempts += 1;
    this.retry?.dispose();
    this.retry = this.runtime.scheduleRetry(() => {
      this.retry = undefined;
      this.startNativeLeg();
    }, delay);
  }

  private startChokidarLeg(): void {
    if (this.chokidarLeg !== undefined) return;
    const leg = new HostFsWatchHandle(
      this.root,
      { recursive: true, ignored: this.ignored },
      this.toRequestedPath,
    );
    leg.onDidChange((event) => {
      if (!this.disposed) this.emitter.fire(event);
    });
    void leg.ready.then(
      () => this.readiness.resolve(),
      (error: unknown) => this.readiness.reject(error),
    );
    this.chokidarLeg = leg;
  }

  private fireInvalidation(): void {
    this.emitter.fire({
      path: this.toRequestedPath(this.root),
      action: 'modified',
      kind: 'directory',
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readiness.resolve();
    this.retry?.dispose();
    this.nativeWatcher?.close();
    this.chokidarLeg?.dispose();
    this.emitter.dispose();
  }
}

export class HostFsWatchService implements IHostFsWatchService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly runtime: HostFsWatchRuntime = NODE_HOST_FS_WATCH_RUNTIME) {}

  watch(path: string, options?: HostFsWatchOptions): IHostFsWatchHandle {
    if (!isHostFsWatchEnabled()) return disabledHostFsWatchHandle();
    const watched = this.runtime.resolvePath?.(path) ?? path;
    const toRequestedPath = (changed: string): string =>
      watched === path ? changed : requestedPath(watched, path, changed);
    const ignored = options?.ignored;
    const mappedOptions: HostFsWatchOptions | undefined =
      ignored === undefined
        ? options
        : { ...options, ignored: (changed: string) => ignored(toRequestedPath(changed)) };
    if (useNativeRecursive(mappedOptions, this.runtime.platform)) {
      return new SignalWatchHandle(watched, mappedOptions, this.runtime, toRequestedPath);
    }
    return new HostFsWatchHandle(watched, mappedOptions, toRequestedPath);
  }

  watchCandidates(
    root: string,
    candidates: readonly string[],
    options?: HostFsWatchOptions,
  ): IHostFsWatchHandle {
    if (!isHostFsWatchEnabled()) return disabledHostFsWatchHandle();
    return new CandidateWatchHandle(this, root, candidates, options);
  }
}

function disabledHostFsWatchHandle(): IHostFsWatchHandle {
  return {
    ready: Promise.resolve(),
    onDidChange: () => ({ dispose: () => {} }),
    dispose: () => {},
  };
}

class CandidateWatchHandle implements IHostFsWatchHandle {
  readonly ready: Promise<void>;
  readonly onDidChange: Event<HostFsChange>;

  private readonly readiness = createWatchReadiness();
  private readonly emitter: Emitter<HostFsChange>;
  private handles: IHostFsWatchHandle[] = [];
  private planKey = '';
  private disposed = false;

  constructor(
    private readonly service: HostFsWatchService,
    private readonly root: string,
    private readonly candidates: readonly string[],
    private readonly options: HostFsWatchOptions | undefined,
  ) {
    this.ready = this.readiness.promise;
    this.emitter = new Emitter<HostFsChange>();
    this.onDidChange = this.emitter.event;
    void this.rebuild(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readiness.resolve();
    this.teardown();
    this.emitter.dispose();
  }

  private async rebuild(initial: boolean): Promise<void> {
    if (this.disposed) return;
    const plan = planCandidateWatches(this.root, this.candidates);
    const key = `${plan.notify.join('\0')}\0\0${plan.paths.join('\0')}\0\0${plan.pending.join('\0')}`;
    if (!initial && key === this.planKey) return;
    this.planKey = key;
    this.teardown();
    const next: IHostFsWatchHandle[] = [];
    for (const path of plan.paths) next.push(this.service.watch(path, this.options));
    for (const dir of plan.notify) {
      if (!watchPathExists(dir)) continue;
      next.push(
        this.service.watch(dir, {
          ...this.options,
          recursive: false,
          ignored: (path) =>
            !isCandidateRelated(dir, this.candidates, path) ||
            (this.options?.ignored?.(path) ?? false),
        }),
      );
    }
    for (const path of plan.pending) next.push(this.service.watch(path, this.options));
    this.handles = next;
    for (const handle of next) {
      handle.onDidChange((change) => {
        if (this.disposed) return;
        void this.rebuild(false);
        this.emitter.fire(change);
      });
    }
    try {
      await Promise.all(next.map((handle) => handle.ready));
      this.readiness.resolve();
    } catch (error) {
      this.readiness.reject(error);
    }
  }

  private teardown(): void {
    for (const handle of this.handles) handle.dispose();
    this.handles = [];
  }
}

function planCandidateWatches(
  root: string,
  candidates: readonly string[],
): {
  readonly paths: readonly string[];
  readonly notify: readonly string[];
  readonly pending: readonly string[];
} {
  const paths = new Set<string>();
  const notify = new Set<string>();
  const pending = new Set<string>();
  for (const candidate of candidates) {
    if (watchPathExists(candidate)) {
      paths.add(candidate);
      continue;
    }
    let current = dirname(candidate);
    while (!watchPathExists(current) && !sameWatchPath(current, root)) {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (watchPathExists(current) && !isKimiCodeDir(current)) notify.add(current);
    else pending.add(candidate);
  }
  return {
    paths: [...paths].toSorted(),
    notify: [...notify].toSorted(),
    pending: [...pending].toSorted(),
  };
}

function isKimiCodeDir(path: string): boolean {
  const name = basename(path);
  return process.platform === 'win32' ? name.toLowerCase() === '.kimi-code' : name === '.kimi-code';
}

function isCandidateRelated(root: string, candidates: readonly string[], path: string): boolean {
  for (const candidate of candidates) {
    if (sameWatchPath(path, candidate)) return true;
    if (isPathInside(path, candidate) || isPathInside(candidate, path)) return true;
    const segment = firstPathSegment(root, candidate);
    if (segment !== undefined && (basename(path) === segment || path.endsWith(`${sep}${segment}`))) {
      return true;
    }
  }
  return false;
}

function firstPathSegment(root: string, candidate: string): string | undefined {
  const rel = relative(root, candidate);
  if (rel === '' || isOutside(rel)) return undefined;
  return rel.split(/[/\\]/)[0];
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel !== '' && !isOutside(rel);
}

function sameWatchPath(left: string, right: string): boolean {
  const a = left.replaceAll('\\', '/').replace(/\/+$/, '');
  const b = right.replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function watchPathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function useNativeRecursive(
  options: HostFsWatchOptions | undefined,
  platform: NodeJS.Platform,
): boolean {
  return (
    options?.signal === true &&
    options.recursive !== false &&
    (platform === 'darwin' || platform === 'win32')
  );
}

function resolveNativeSignalPath(root: string, filename: string | null): string {
  if (filename === null || filename === '' || filename === basename(root)) return root;
  return clampToRoot(root, isAbsolute(filename) ? filename : join(root, filename));
}

function clampToRoot(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  if (rel === '' || !isOutside(rel)) return absPath;
  return root;
}

function resolveLongPath(path: string): string {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function requestedPath(watched: string, requested: string, changed: string): string {
  const rel = relative(watched, changed);
  if (rel === '') return requested;
  if (isOutside(rel)) return changed;
  return join(requested, rel);
}

function isOutside(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function mapChokidarEvent(eventName: string, absPath: string): HostFsChange | undefined {
  const mapped = mapActionAndKind(eventName);
  if (mapped === undefined) return undefined;
  return { path: absPath, action: mapped.action, kind: mapped.kind };
}

function mapActionAndKind(
  eventName: string,
): { action: HostFsChangeAction; kind: HostFsChangeKind } | undefined {
  switch (eventName) {
    case 'add':
      return { action: 'created', kind: 'file' };
    case 'addDir':
      return { action: 'created', kind: 'directory' };
    case 'change':
      return { action: 'modified', kind: 'file' };
    case 'unlink':
      return { action: 'deleted', kind: 'file' };
    case 'unlinkDir':
      return { action: 'deleted', kind: 'directory' };
    default:
      return undefined;
  }
}

registerScopedService(
  LifecycleScope.App,
  IHostFsWatchService,
  HostFsWatchService,
  ScopeActivation.OnScopeCreated,
  'hostFsWatch',
);
