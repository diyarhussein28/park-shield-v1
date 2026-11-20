/**
 * Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits, typed on an Arabic or Persian keyboard,
 * become ASCII digits; everything else is kept. Codes, postcodes and phone numbers stay usable
 * whatever keyboard the phone has.
 */
export function asciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Only the digits of the input (after conversion), at most `max`. */
export const digitsOnly = (input: string, max: number) =>
  asciiDigits(input).replace(/\D/g, '').slice(0, max);
