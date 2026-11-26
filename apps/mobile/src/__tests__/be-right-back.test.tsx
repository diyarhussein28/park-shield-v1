import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BeRightBack } from '@/components/be-right-back';
import { setSession } from '@/lib/session';
import { mmss, statusChanged } from '@/lib/vehicle-status';
import { handleResponse, statusPushOf } from '@/lib/push';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

const V = '5b0c2a7e-3d4f-4a1b-9c8d-7e6f5a4b3c2d';
type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let current: Record<string, unknown> | null = null;
let enabled = true;

const status = (over: Record<string, unknown> = {}) => ({
  presetKey: 'BACK_FEW_MIN',
  customText: null,
  durationMin: 10,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  canExtend: true,
  waitingCount: 0,
  ...over,
});

beforeEach(async () => {
  calls = [];
  current = null;
  enabled = true;
  await setSession('session-token-0000000000000000000001');
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path, body });
    const json = (status: number, b: unknown) =>
      ({ ok: status < 300, status, json: async () => b }) as Response;
    if (path === `/v1/vehicles/${V}/status` && method === 'GET')
      return json(200, { enabled, status: current });
    if (path === `/v1/vehicles/${V}/status` && method === 'PUT') {
      if (typeof body?.customText === 'string' && body.customText.includes('0171'))
        return json(422, { error: 'text_contact_data' });
      current = status({
        presetKey: body?.presetKey ?? null,
        customText: body?.customText ?? null,
        durationMin: body?.durationMin,
        expiresAt: new Date(Date.now() + Number(body?.durationMin) * 60_000).toISOString(),
      });
      return json(200, { status: current });
    }
    if (path === `/v1/vehicles/${V}/status/extend`) {
      current = status({ expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      return json(200, { status: current });
    }
    if (path === `/v1/vehicles/${V}/status` && method === 'DELETE') {
      current = null;
      return json(200, { ok: true });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
});

describe('„Bin gleich zurück“ in the app', () => {
  it('is hidden while the feature is off', async () => {
    enabled = false;
    await render(<BeRightBack vehicleId={V} />);
    await act(async () => {});
    expect(screen.queryByTestId('brb-open')).toBeNull();
  });

  it('activates in two taps with the defaults (first preset, 10 min) and shows the banner', async () => {
    await render(<BeRightBack vehicleId={V} />);
    await fireEvent.press(await screen.findByTestId('brb-open'));
    expect(screen.getByTestId('brb-preset-BACK_FEW_MIN').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.getByTestId('brb-duration-10').props.accessibilityState).toEqual({
      checked: true,
    });
    // The preview reads like the scan page.
    expect(screen.getByTestId('brb-preview')).toHaveTextContent(
      /Nachricht vom Fahrzeughalter.*Bin in wenigen Minuten zurück\..*Zurück in ca\. 10 Min.*Ich warte/,
    );
    expect(
      screen.getByText(
        'Bitte beachten Sie die Verkehrsregeln. Die Nachricht ersetzt keine Park- oder Halteerlaubnis.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('brb-activate'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      presetKey: 'BACK_FEW_MIN',
      durationMin: 10,
    });
    expect(await screen.findByTestId('brb-banner')).toBeTruthy();
    expect(screen.getByTestId('brb-message')).toHaveTextContent('Bin in wenigen Minuten zurück.');
    expect(screen.getByTestId('brb-countdown')).toHaveTextContent(/Endet in (09:5\d|10:00)/);
    expect(screen.getByText('Aktiv')).toBeTruthy();
  });

  it('counts the custom text live and checks it like the API', async () => {
    await render(<BeRightBack vehicleId={V} />);
    await fireEvent.press(await screen.findByTestId('brb-open'));
    await fireEvent.press(screen.getByTestId('brb-preset-CUSTOM'));
    expect(
      screen.getByText(
        'Diese Nachricht sieht jeder, der den QR-Code scannt. Keine persönlichen Daten angeben.',
      ),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('brb-text'), 'x'.repeat(150));
    expect(screen.getByTestId('brb-counter')).toHaveTextContent('150/150');
    expect(screen.queryByTestId('brb-text-error')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('brb-text'), 'x'.repeat(151));
    expect(screen.getByTestId('brb-text-error')).toHaveTextContent('Höchstens 150 Zeichen.');
    await fireEvent.changeText(screen.getByTestId('brb-text'), 'Ruf an: 0171 2345678');
    expect(screen.getByTestId('brb-text-error')).toHaveTextContent(
      'Bitte keine Telefonnummern, E-Mail-Adressen oder Links.',
    );
    expect(screen.getByTestId('brb-activate').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('brb-text'), 'Hole nur kurz die Post.');
    await fireEvent.press(screen.getByTestId('brb-duration-5'));
    await fireEvent.press(screen.getByTestId('brb-activate'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      customText: 'Hole nur kurz die Post.',
      durationMin: 5,
    });
    expect(await screen.findByTestId('brb-message')).toHaveTextContent('Hole nur kurz die Post.');
  });

  it('extends, disables „+5 Min“ at the 60-min cap and ends', async () => {
    current = status({
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      waitingCount: 1,
    });
    await render(<BeRightBack vehicleId={V} />);
    expect(await screen.findByTestId('brb-waiting')).toHaveTextContent('1 Person wartet');
    expect(screen.getByTestId('brb-extend').props.accessibilityState.disabled).toBe(true);
    current = status();
    await act(async () => statusChanged(V));
    expect(screen.getByTestId('brb-extend').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('brb-extend'));
    expect(calls.some((c) => c.path.endsWith('/status/extend'))).toBe(true);
    await fireEvent.press(screen.getByTestId('brb-end'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(await screen.findByTestId('brb-open')).toBeTruthy();
  });

  it('drops the banner when the status ends on the server (push or refetch)', async () => {
    current = status();
    await render(<BeRightBack vehicleId={V} />);
    expect(await screen.findByTestId('brb-banner')).toBeTruthy();
    current = null;
    await act(async () => statusChanged(V));
    expect(screen.queryByTestId('brb-banner')).toBeNull();
    expect(screen.getByTestId('brb-open')).toBeTruthy();
  });
});

describe('the pre-expiry notification', () => {
  const response = (actionIdentifier: string) =>
    ({
      actionIdentifier,
      notification: {
        request: {
          content: { data: { vehicleId: V, kind: 'brb_expiring' } },
          trigger: null,
        },
      },
    }) as never;

  it('„+5 Min“ and „Beenden“ call the API and open the vehicle', async () => {
    const openVehicle = jest.fn();
    expect(await handleResponse(response('PS_BRB_EXTEND'), jest.fn(), openVehicle)).toBe(
      'extended',
    );
    expect(calls.some((c) => c.path === `/v1/vehicles/${V}/status/extend`)).toBe(true);
    expect(await handleResponse(response('PS_BRB_END'), jest.fn(), openVehicle)).toBe('ended');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(openVehicle).toHaveBeenCalledWith(V);
  });

  it('recognises only well-formed status pushes', () => {
    expect(statusPushOf({ kind: 'brb_ended', vehicleId: V })).toEqual({
      kind: 'brb_ended',
      vehicleId: V,
    });
    expect(statusPushOf({ kind: 'alert', vehicleId: V })).toBeNull();
    expect(statusPushOf({ kind: 'brb_ended', vehicleId: 'x' })).toBeNull();
    expect(mmss(61_000)).toBe('01:01');
    expect(mmss(-5)).toBe('00:00');
  });
});
