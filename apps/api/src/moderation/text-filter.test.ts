import { describe, expect, it } from 'vitest';
import { filterText } from './text-filter';

describe('filterText', () => {
  it.each([
    'Kontaktieren Sie mich',
    'Blockiere ich Sie? Bitte scannen',
    'Bin in 10 Min zurück',
    'Ihr Licht brennt noch, Haus Nr. 12',
    'Grüße aus Köln!',
  ])('allows "%s"', (text) => {
    expect(filterText(text).ok).toBe(true);
  });

  it.each([
    ['Ruf an: 0171 2345678', 'phone'],
    ['+49 (171) 234-56-78', 'phone'],
    ['0 1 7 1 2 3 4 5', 'phone'],
    ['mail jonas@example.de', 'email'],
    ['jonas (at) example.de', 'email'],
    ['siehe www.example.com', 'link'],
    ['https://bit.ly/x', 'link'],
    ['besuch fakeseite.de', 'link'],
    ['Du Idiot', 'insult'],
    ['A r s c h l o c h', 'insult'],
    ['du 4rschloch', 'insult'],
    ['ich werde dein Auto zerkratzen', 'threat'],
  ])('blocks "%s" (%s)', (text, reason) => {
    expect(filterText(text)).toEqual({ ok: false, reason });
  });

  it('uses list overrides from ops when given', () => {
    expect(filterText('Sie Banause', { insults: ['banause'] }).ok).toBe(false);
    expect(filterText('Du Idiot', { insults: [] }).ok).toBe(true);
  });
});
