import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BrandTabBar } from '@/components/tab-bar';
import { openAlertCount } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));

const alert = (over: Partial<AlertListItem>): AlertListItem => ({
  id: 'a',
  type: { code: 'lights_on', de: 'Licht brennt noch', en: 'Lights are on' },
  severity: 'normal',
  status: 'delivered',
  isTest: false,
  createdAt: '2026-11-19T12:00:00Z',
  seenAt: null,
  acknowledged: false,
  acknowledgedBy: null,
  escalationStep: 0,
  vehicle: { id: 'v', nickname: 'Blue' },
  photoCount: 0,
  chatStatus: null,
  ...over,
});

it('counts open alerts: not acknowledged and not expired', () => {
  expect(
    openAlertCount([
      alert({ id: '1' }),
      alert({ id: '2', seenAt: '2026-11-19T12:01:00Z' }),
      alert({ id: '3', acknowledged: true }),
      alert({ id: '4', status: 'expired' }),
    ]),
  ).toBe(2);
  expect(openAlertCount([])).toBe(0);
});

const routes = ['index', 'fahrzeuge', 'konto', 'mehr'].map((name) => ({ key: `${name}-k`, name }));
const props = (index = 0) => ({
  state: { index, routes },
  emitter: { emit: jest.fn(() => ({ defaultPrevented: false })) },
  navigateToTab: jest.fn(),
  insets: { top: 0, bottom: 20, left: 0, right: 0 },
});

describe('the tab bar', () => {
  it('shows four labelled tabs, the active one selected; a press switches by route key', async () => {
    const p = props(0);
    await render(<BrandTabBar {...p} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    for (const label of [t('tabAlerts'), t('tabVehicles'), t('tabAccount'), t('tabMore')]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(tabs[0]!.props.accessibilityState.selected).toBe(true);
    expect(tabs[2]!.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(tabs[2]!);
    expect(p.emitter.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'konto-k',
      canPreventDefault: true,
    });
    expect(p.navigateToTab).toHaveBeenCalledWith('konto-k');
  });

  it('labels stay on one line at large text sizes', async () => {
    await render(<BrandTabBar {...props()} />);
    const label = screen.getByText(t('tabVehicles'));
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
  });

  it('the alerts badge shows the count, „99+“ above 99, nothing at 0', async () => {
    const { rerender } = await render(<BrandTabBar {...props()} badges={{ index: 3 }} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByRole('tab')[0]!.props.accessibilityLabel).toContain('3');
    await rerender(<BrandTabBar {...props()} badges={{ index: 120 }} />);
    expect(screen.getByText('99+')).toBeTruthy();
    await rerender(<BrandTabBar {...props()} badges={{ index: 0 }} />);
    expect(screen.queryByText('0')).toBeNull();
  });
});

it('push targets stay outside the tab group; the old overview is gone', () => {
  const app = join(__dirname, '../app');
  for (const route of [
    'alerts/[id].tsx',
    'chat/[id].tsx',
    'fahrzeug/[id].tsx',
    'app/alerts/[id].tsx',
  ]) {
    expect([route, existsSync(join(app, route))]).toEqual([route, true]);
    expect([route, existsSync(join(app, '(tabs)', route))]).toEqual([route, false]);
  }
  for (const tab of ['index.tsx', 'fahrzeuge.tsx', 'konto.tsx', 'mehr.tsx', '_layout.tsx']) {
    expect([tab, existsSync(join(app, '(tabs)', tab))]).toEqual([tab, true]);
  }
  expect(existsSync(join(app, 'uebersicht.tsx'))).toBe(false);
});
