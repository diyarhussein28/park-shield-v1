import { pt } from './portal-i18n';

it('uses the website texts, with ICU dates and plurals', () => {
  expect(pt('cancel.title')).toBe('Verträge hier kündigen');
  expect(pt('account.endsOn', { date: new Date('2027-11-19T12:00:00Z') })).toMatch(
    /19\. November 2027/,
  );
});
