import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  flattenKeys,
  LOCALES,
  lookupMessage,
  messages,
  negotiateLocale,
} from './index';

describe('message bundles', () => {
  const deKeys = flattenKeys(messages.de).sort();

  it.each(LOCALES)('%s has exactly the same keys as de', (locale) => {
    expect(flattenKeys(messages[locale]).sort()).toEqual(deKeys);
  });

  it.each(LOCALES)('every %s message is valid ICU', (locale) => {
    for (const key of deKeys) {
      const source = lookupMessage(messages[locale], key)!;
      expect(() => new IntlMessageFormat(source, locale), `${locale}:${key}`).not.toThrow();
    }
  });
});

describe('createTranslator', () => {
  it('formats plurals per locale', () => {
    expect(createTranslator('de')('design.vehicles', { count: 1 })).toBe('1 Fahrzeug');
    expect(createTranslator('en')('design.vehicles', { count: 2 })).toBe('2 vehicles');
    expect(createTranslator('en')('design.vehicles', { count: 0 })).toBe('No vehicles');
  });

  it('returns the key for a missing message', () => {
    expect(createTranslator('de')('nope.missing' as never)).toBe('nope.missing');
  });
});

describe('negotiateLocale', () => {
  it.each([
    [undefined, 'de'],
    ['', 'de'],
    ['en-US,en;q=0.9', 'en'],
    ['fr-FR,fr;q=0.9,en;q=0.5', 'en'],
    ['tr-TR', 'de'],
    ['en;q=0.2,de;q=0.8', 'de'],
    ['en;q=0', 'de'],
  ])('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});
