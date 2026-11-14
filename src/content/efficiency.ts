/**
 * The canonical efficiency axes from the Phase 1 spec. Every non-cosmetic
 * reward (tool, placeable, creature role, producer, contract) must declare at
 * least one axis it improves; content validation fails the build otherwise.
 */
export const EFFICIENCY_AXES = [
  'locate', 'travel', 'break', 'yield', 'pickup',
  'carry', 'process', 'renew', 'uptime', 'safety',
] as const;

export type EfficiencyAxis = (typeof EFFICIENCY_AXES)[number];
export type NonEmptyEfficiencyAxes = readonly [EfficiencyAxis, ...EfficiencyAxis[]];

export function isEfficiencyAxis(value: unknown): value is EfficiencyAxis {
  return typeof value === 'string' && (EFFICIENCY_AXES as readonly string[]).includes(value);
}
