// Shared ship-image scale used by the Ship Editor preview and the scenario
// map. One hex radius represents 50 ft, so a keel length in feet maps directly
// to the rendered image height in pixels.

export const SHIP_IMAGE_FEET_PER_HEX = 50;

export function shipImageHeightPx(keelLength: number, hexRadiusPx: number): number {
  return (Math.max(1, keelLength) * hexRadiusPx) / SHIP_IMAGE_FEET_PER_HEX;
}

/** Positive = move the image up from the hex centre. */
export function shipImageOffsetPx(imageOffsetY: number, hexRadiusPx: number): number {
  return (imageOffsetY * hexRadiusPx) / SHIP_IMAGE_FEET_PER_HEX;
}
