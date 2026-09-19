import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type { IDisposable } from '#/_base/di/lifecycle';

export type HostFsChangeKind = 'file' | 'directory';
export type HostFsChangeAction = 'created' | 'modified' | 'deleted';

export interface HostFsChange {
  readonly path: string;
  readonly action: HostFsChangeAction;
  readonly kind: HostFsChangeKind;
}

export interface HostFsWatchOptions {
  readonly recursive?: boolean;
  readonly ignored?: (path: string) => boolean;
  readonly signal?: boolean;
}

export interface IHostFsWatchHandle extends IDisposable {
  readonly ready: Promise<void>;
  readonly onDidChange: Event<HostFsChange>;
}

export interface IHostFsWatchService {
  readonly _serviceBrand: undefined;

  watch(path: string, options?: HostFsWatchOptions): IHostFsWatchHandle;

  /**
   * Watches concrete candidate paths under `root` instead of listing the root
   * itself, so a flooded project root cannot fill the watcher inventory.
   * Missing candidates are watched through their nearest existing ancestor
   * (non-recursive) and the plan rebuilds as candidates appear or disappear.
   */
  watchCandidates(
    root: string,
    candidates: readonly string[],
    options?: HostFsWatchOptions,
  ): IHostFsWatchHandle;
}

export const HOST_FS_WATCH_ENV = 'KIMI_CODE_WATCH';

const TRUE_WATCH_ENV = new Set(['1', 'true', 'yes', 'on']);
const FALSE_WATCH_ENV = new Set(['0', 'false', 'no', 'off']);

let hostFsWatchEnabledFromConfig = true;

export function setHostFsWatchEnabled(enabled: boolean): void {
  hostFsWatchEnabledFromConfig = enabled;
}

export function isHostFsWatchEnabled(): boolean {
  const raw = process.env[HOST_FS_WATCH_ENV]?.trim().toLowerCase();
  if (raw !== undefined && raw.length > 0) {
    if (FALSE_WATCH_ENV.has(raw)) return false;
    if (TRUE_WATCH_ENV.has(raw)) return true;
  }
  return hostFsWatchEnabledFromConfig;
}

export const IHostFsWatchService: ServiceIdentifier<IHostFsWatchService> =
  createDecorator<IHostFsWatchService>('hostFsWatchService');
