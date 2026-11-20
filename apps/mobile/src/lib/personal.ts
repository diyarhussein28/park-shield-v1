// Same patterns as the API (apps/api/src/chat/chat.service.ts): owner messages that look like personal
// data get a warning before sending; they are not blocked.
const PHONE = /(?:\+|00)?\d[\d\s/().-]{6,}\d/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const ADDRESS = /\b[\p{L}ß.-]{3,}(?:straße|strasse|str\.|weg|gasse|allee|platz|ring|damm)\s*\d+/iu;

export const looksPersonal = (text: string): boolean =>
  PHONE.test(text) || EMAIL.test(text) || ADDRESS.test(text);
