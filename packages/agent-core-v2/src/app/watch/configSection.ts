import { z } from 'zod';

import { parseBooleanEnv } from '#/_base/utils/env';
import { type EnvBindings, envBindings, stripEnvBoundFields } from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import { HOST_FS_WATCH_ENV } from '#/os/interface/hostFsWatch';

export const WATCH_SECTION = 'watch';

export const WatchConfigSchema = z.object({
  enabled: z.boolean().optional(),
});

export type WatchConfig = z.infer<typeof WatchConfigSchema>;

export const watchEnvBindings: EnvBindings<WatchConfig> = envBindings(WatchConfigSchema, {
  enabled: { env: HOST_FS_WATCH_ENV, parse: parseBooleanEnv },
});

export const stripWatchEnv = stripEnvBoundFields(watchEnvBindings);

registerConfigSection(WATCH_SECTION, WatchConfigSchema, {
  env: watchEnvBindings,
  stripEnv: stripWatchEnv,
});
