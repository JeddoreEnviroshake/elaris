/**
 * Build identity injected by Vite at build time (see vite.config.ts `define`).
 * Surfaced in the About/Diagnostics panel and used to reason about updates.
 */
export interface BuildInfo {
  commit: string;
  builtAt: string;
}

export const buildInfo: BuildInfo = {
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILT_AT__,
};

/** Human-readable single-line label, e.g. "a1b2c3d · 2026-07-11 19:40Z". */
export function buildLabel(info: BuildInfo = buildInfo): string {
  const when = Number.isNaN(Date.parse(info.builtAt))
    ? info.builtAt
    : `${info.builtAt.slice(0, 16).replace('T', ' ')}Z`;
  return `${info.commit} · ${when}`;
}
