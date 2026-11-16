/** Distances are in tiles. Keep an opening open until the player clears it. */
export function doorSwingTarget(distance: number, openness: number, firstPerson: boolean): number {
  const openRadius = firstPerson ? 3.8 : 1.35;
  const closeRadius = firstPerson ? 5 : 1.9;
  return distance <= openRadius || (openness > 0 && distance < closeRadius) ? 1 : 0;
}

export function doorSwingSeconds(firstPerson: boolean): number {
  return firstPerson ? 0.55 : 0.18;
}
