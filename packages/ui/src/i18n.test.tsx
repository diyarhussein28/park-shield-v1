import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, LanguageSwitch, useI18n } from './i18n';

function Greeting() {
  const { t } = useI18n();
  return <p data-testid="msg">{t('design.vehicles', { count: 2 })}</p>;
}

afterEach(cleanup);

describe('I18nProvider + LanguageSwitch', () => {
  it('switches language in place without reloading', () => {
    const onChange = vi.fn();
    render(
      <I18nProvider initialLocale="de" onLocaleChange={onChange}>
        <LanguageSwitch />
        <Greeting />
      </I18nProvider>,
    );
    const marker = screen.getByTestId('msg');
    expect(marker.textContent).toBe('2 Fahrzeuge');
    expect(document.documentElement.lang).toBe('de');

    const english = screen.getByRole('button', { name: /^EN\b.*English$/ });
    fireEvent.click(english);

    expect(screen.getByTestId('msg')).toBe(marker); // same DOM node: no remount, no reload
    expect(marker.textContent).toBe('2 vehicles');
    expect(document.documentElement.lang).toBe('en');
    expect(onChange).toHaveBeenCalledWith('en');
    expect(english.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the visible language code inside the accessible name (WCAG 2.5.3)', () => {
    render(
      <I18nProvider initialLocale="de">
        <LanguageSwitch />
      </I18nProvider>,
    );
    for (const button of screen.getAllByRole('button')) {
      const visible = button.childNodes[0]?.textContent ?? '';
      expect(visible).toMatch(/^(DE|EN)$/);
      expect(button.textContent).toContain(visible);
    }
  });
});
