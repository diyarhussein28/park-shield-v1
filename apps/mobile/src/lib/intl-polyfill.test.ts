/**
 * Hermes has no Intl.PluralRules and no Intl.Locale (Node has both, which is how a missing polyfill
 * once slipped through: „Intl.PluralRules is not available in this environment“ on the iPhone).
 * This test removes them like Hermes and formats the website's plural texts.
 */
const real = { PluralRules: Intl.PluralRules, Locale: Intl.Locale };

afterAll(() => {
  Object.assign(Intl, real);
});

it('formats ICU plurals without the engine providing Intl.PluralRules or Intl.Locale', () => {
  // @ts-expect-error simulating Hermes
  delete Intl.PluralRules;
  // @ts-expect-error simulating Hermes
  delete Intl.Locale;
  expect(Intl.PluralRules).toBeUndefined();

  jest.isolateModules(() => {
    const { pt } = require('./portal-i18n') as typeof import('./portal-i18n');
    expect(Intl.PluralRules).toBeDefined();
    // The vehicle modes card („30 Minuten“ … „12 Stunden“), where the crash happened.
    expect(pt('modes.minutes', { minutes: 30, hours: 0.5 })).toBe('30 Minuten');
    expect(pt('modes.minutes', { minutes: 60, hours: 1 })).toBe('1 Stunde');
    expect(pt('modes.minutes', { minutes: 720, hours: 12 })).toBe('12 Stunden');
    expect(pt('history.photos', { count: 1 })).toMatch(/^Ein Foto angehängt/);
    expect(pt('history.photos', { count: 2 })).toMatch(/^2 Fotos angehängt/);
  });
});
