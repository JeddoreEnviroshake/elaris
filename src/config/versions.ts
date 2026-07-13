import { buildInfo } from '../platform/buildInfo';

/**
 * Content/world versions stamped into saves. Bump WORLD_GEN_VERSION when the
 * seed→world mapping changes and CONTENT_VERSION when content definitions
 * change in a way that affects saved references.
 */
export const WORLD_GEN_VERSION = 6;
export const CONTENT_VERSION = 16;
export const SAVE_SCHEMA_VERSION = 17;
export const APP_VERSION = buildInfo.commit;
