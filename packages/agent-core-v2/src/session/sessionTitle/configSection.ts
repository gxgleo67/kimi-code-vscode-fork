import { z } from 'zod';

import { type IConfigService } from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const AUTO_SESSION_TITLE_SECTION = 'autoSessionTitle';

export const AutoSessionTitleConfigSchema = z.boolean().optional();

export type AutoSessionTitleConfig = z.infer<typeof AutoSessionTitleConfigSchema>;

registerConfigSection(AUTO_SESSION_TITLE_SECTION, AutoSessionTitleConfigSchema, {
  defaultValue: true,
});

export function autoSessionTitleEnabled(config: IConfigService): boolean {
  return config.get<AutoSessionTitleConfig>(AUTO_SESSION_TITLE_SECTION) !== false;
}
