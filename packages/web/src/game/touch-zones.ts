// Touch zone geometry and hit-testing.
//
// Split out of input.ts (see notes/archive/T-06-HELM/log.md). Pure and side-effect-free: no event
// listeners, no DOM mutation, nothing stateful beyond the plain values passed in. `input.ts` owns
// all of that; this module only answers "where is this point".

export interface TouchZones {
  boost: DOMRect;
  brake: DOMRect;
}

export type ZoneName = "boost" | "brake";

/** Point-in-rect hit test using DOMRect's left/top/right/bottom, inclusive of the edges. */
export function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Classifies a point against the boost/brake zones. `boost` is checked first, so if a caller ever
 * passes overlapping rects (a UI layout bug, not something this module can prevent) the overlap
 * resolves to boost — an arbitrary but deterministic tie-break, not a claim that overlap is a
 * supported configuration. Returns `null` when zones haven't been attached yet (`zones` is `null`)
 * or the point falls outside both rects.
 */
export function classifyPoint(
  zones: TouchZones | null,
  x: number,
  y: number,
): ZoneName | null {
  if (!zones) return null;
  if (pointInRect(x, y, zones.boost)) return "boost";
  if (pointInRect(x, y, zones.brake)) return "brake";
  return null;
}
