import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react-native';
import { alertTypeIcon, ICON_PATHS, LogoMark, Wordmark } from './icons';

it('maps every alert type to an icon of the website set', () => {
  expect(alertTypeIcon('blocking')).toBe('car');
  expect(alertTypeIcon('lights_on')).toBe('lightbulb');
  expect(alertTypeIcon('window_open')).toBe('cloudRain');
  expect(alertTypeIcon('damage')).toBe('alert');
  expect(alertTypeIcon('alarm')).toBe('bell');
  expect(alertTypeIcon('towing_risk')).toBe('truck');
  expect(alertTypeIcon('custom')).toBe('chat');
  expect(alertTypeIcon('something_new')).toBe('alert');
});

it('has every icon of the website, with the same paths', () => {
  const src = readFileSync(join(__dirname, '../../../web/components/icons.tsx'), 'utf8');
  const block = src.slice(src.indexOf('const paths = {'), src.indexOf('} as const'));
  const web = Object.fromEntries(
    [...block.matchAll(/^\s+(\w+):\s*'([^']+)'/gm)].map((m) => [m[1]!, m[2]!]),
  );
  expect(Object.keys(web).length).toBeGreaterThan(30);
  expect(ICON_PATHS).toEqual(web);
});

/** All props objects in the rendered tree (RNTL 14 has no UNSAFE_ prop queries). */
type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
const allProps = (node: Node | Node[] | null): Record<string, unknown>[] => {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(allProps);
  const kids = (node.children ?? []).filter((k): k is Node => typeof k !== 'string');
  return [node.props ?? {}, ...kids.flatMap(allProps)];
};

it('draws the website logo: the shield and the yellow QR square', async () => {
  await render(<LogoMark size={32} />);
  const props = allProps(screen.toJSON() as Node);
  expect(
    props.some(
      (p) => p.d === 'M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z',
    ),
  ).toBe(true);
  expect(props.some((p) => p.fill === '#facc15')).toBe(true);
});

it('the wordmark reads ParkShield, „Shield“ in the primary colour', async () => {
  await render(<Wordmark />);
  expect(screen.getByText('Shield').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ color: '#1d4ed8' })]),
  );
  expect(screen.getByLabelText('ParkShield')).toBeTruthy();
});

it('illustration slots are decorative placeholders of 160 pt for every named slot', async () => {
  const { Illustration } = require('./illustration') as typeof import('./illustration');
  for (const name of ['empty-alerts', 'empty-vehicles', 'decal-placement', 'alert-sent'] as const) {
    await render(<Illustration name={name} />);
    const root = screen.getByTestId(`illustration-${name}`, { includeHiddenElements: true });
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.style).toEqual(expect.objectContaining({ height: 160 }));
  }
});
