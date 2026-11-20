import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Field, ListRow, Segmented } from './form';
import { Button, Chip, EmptyState, ProgressBar, Section } from './ui';

type AnyStyle = Parameters<typeof StyleSheet.flatten>[0];
const style = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(
    (typeof el.props.style === 'function'
      ? (el.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : el.props.style) as AnyStyle,
  ) as Record<string, unknown>;

it('buttons are 52 pt, the large one 56; ghost has no border', async () => {
  await render(
    <>
      <Button label="Normal" onPress={() => {}} />
      <Button label="Ich komme" size="lg" onPress={() => {}} />
      <Button label="Leise" variant="ghost" onPress={() => {}} />
    </>,
  );
  expect(style(screen.getByLabelText('Normal')).minHeight).toBe(52);
  expect(style(screen.getByLabelText('Ich komme')).minHeight).toBe(56);
  expect(style(screen.getByLabelText('Leise')).borderWidth ?? 0).toBe(0);
});

it('an empty state shows title, text and its one action', async () => {
  const go = jest.fn();
  await render(
    <EmptyState
      illustration="empty-alerts"
      title="Keine Warnungen"
      text="Wenn jemand scannt, sehen Sie es hier."
      action={{ label: 'Aufkleber testen', onPress: go }}
    />,
  );
  expect(screen.getByText('Keine Warnungen')).toBeTruthy();
  expect(screen.getByText('Wenn jemand scannt, sehen Sie es hier.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Aufkleber testen'));
  expect(go).toHaveBeenCalled();
});

it('a segmented control marks the chosen option and reports a change', async () => {
  const change = jest.fn();
  await render(
    <Segmented
      legend="Sprache"
      options={['de', 'en'] as const}
      value="de"
      onChange={change}
      label={(v) => (v === 'de' ? 'Deutsch' : 'English')}
    />,
  );
  expect(screen.getByLabelText('Deutsch').props.accessibilityState.checked).toBe(true);
  expect(screen.getByLabelText('English').props.accessibilityState.checked).toBe(false);
  await fireEvent.press(screen.getByLabelText('English'));
  expect(change).toHaveBeenCalledWith('en');
  expect(style(screen.getByLabelText('English')).minHeight).toBeGreaterThanOrEqual(48);
});

it('the progress bar exposes its value', async () => {
  await render(<ProgressBar percent={40} label="Schutz" />);
  expect(screen.getByLabelText('Schutz').props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: 40,
  });
});

it('a list row reads title and summary, and is at least 48 pt high', async () => {
  const open = jest.fn();
  await render(<ListRow icon="bell" title="Benachrichtigungen" text="2 Geräte" onPress={open} />);
  const row = screen.getByLabelText('Benachrichtigungen, 2 Geräte');
  expect(style(row).minHeight).toBeGreaterThanOrEqual(48);
  await fireEvent.press(row);
  expect(open).toHaveBeenCalled();
});

it('sections have a header; chips and inputs use the website roles', async () => {
  await render(
    <Section title="Rechnungen" intro="Alle Belege">
      <Chip tone="urgent">Dringend</Chip>
      <Field label="E-Mail" value="" onChangeText={() => {}} />
    </Section>,
  );
  expect(screen.getByRole('header', { name: 'Rechnungen' })).toBeTruthy();
  expect(screen.getByText('Alle Belege')).toBeTruthy();
  expect(screen.getByText('Dringend')).toBeTruthy();
  // Input outline: the website's border-strong (3:1 for UI boundaries), not the faint card border.
  expect(style(screen.getByLabelText('E-Mail')).borderColor).toBe('#64748b');
});
