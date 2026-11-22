/**
 * The vehicle label (the owner's name for the car, e.g. „Dodo“) is printed on every decal design
 * (Part B, 2026-11-22). Required, 2–20 characters, letters, numbers, spaces and basic punctuation.
 * The API additionally runs the bad-word filter (`label_invalid`). The licence plate is never printed.
 */
export const VEHICLE_LABEL_MIN = 2;
export const VEHICLE_LABEL_MAX = 20;
export const VEHICLE_LABEL_PATTERN = /^[\p{L}\p{N} .,'’&!?()-]+$/u;

export function isValidVehicleLabel(label: string): boolean {
  const v = label.trim();
  return (
    v.length >= VEHICLE_LABEL_MIN && v.length <= VEHICLE_LABEL_MAX && VEHICLE_LABEL_PATTERN.test(v)
  );
}
