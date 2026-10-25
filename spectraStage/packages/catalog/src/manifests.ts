import { createCatalog } from '@spectrastage/shared';
import { halloweenManifest } from '@spectrastage/theme-halloween/manifest';
import { basicManifest } from '@spectrastage/theme-basic/manifest';

/** All installed themes (build-time registration). The first theme is the default. */
export const catalog = createCatalog([halloweenManifest, basicManifest]);
