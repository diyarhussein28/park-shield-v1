import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import Help from '@/app/hilfe';
import { t } from '@/lib/i18n';
import { setSession } from '@/lib/session';

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `parkshield://${p}`,
  parse: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/lib/profile', () => ({
  useOptionalProfile: () => ({ data: { email: 'kim@example.de' } }),
}));

const reply = (body: unknown, status = 201) =>
  Promise.resolve({ ok: status < 300, status, json: async () => body } as unknown as Response);

beforeEach(async () => {
  jest.clearAllMocks();
  await setSession('session-token-0000000000000000000001');
});

describe('Help screen', () => {
  it('opens the help centre and FAQ on park-shield.de in the in-app browser', async () => {
    await render(<Help />);
    await fireEvent.press(screen.getByTestId('help-faq'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://park-shield.de/hilfe');
  });

  it('checks the form before sending: subject, reply address, message', async () => {
    global.fetch = jest.fn() as jest.Mock;
    await render(<Help />);
    await fireEvent.press(screen.getByTestId('help-contact'));
    // The reply address is pre-filled from the account and can be changed.
    expect(screen.getByTestId('help-email').props.value).toBe('kim@example.de');
    await fireEvent.changeText(screen.getByTestId('help-email'), 'kein-mail');
    await fireEvent.changeText(screen.getByTestId('help-message'), 'kurz');
    await fireEvent.press(screen.getByTestId('help-send'));
    expect(await screen.findByText(t('helpSubjectError'))).toBeTruthy();
    expect(screen.getByText(t('helpEmailError'))).toBeTruthy();
    expect(screen.getByText(t('helpMessageError'))).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the message with the session and confirms with the case number', async () => {
    global.fetch = jest.fn(() => reply({ ticket: 'PS-7K3Q9X2M', replyHours: 48 })) as jest.Mock;
    await render(<Help />);
    await fireEvent.press(screen.getByTestId('help-contact'));
    await fireEvent.changeText(screen.getByTestId('help-subject'), 'Rechnung fehlt');
    await fireEvent.changeText(screen.getByTestId('help-email'), 'Antwort@Example.de');
    await fireEvent.changeText(
      screen.getByTestId('help-message'),
      'Ich finde meine Rechnung nicht.',
    );
    await fireEvent.press(screen.getByTestId('help-send'));
    expect(await screen.findByTestId('help-sent')).toBeTruthy();
    expect(
      screen.getByText(t('helpSent', { ticket: 'PS-7K3Q9X2M', email: 'antwort@example.de' })),
    ).toBeTruthy();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/app\/support\/contact$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
    expect(JSON.parse(String(init.body))).toMatchObject({
      subject: 'Rechnung fehlt',
      email: 'Antwort@Example.de',
      message: 'Ich finde meine Rechnung nicht.',
      locale: 'de',
    });
    // The form closes after sending.
    expect(screen.queryByTestId('help-send')).toBeNull();
  });

  it('shows the error and keeps the text when sending fails', async () => {
    global.fetch = jest.fn(() =>
      reply({ error: 'rate_limited', retryAfterSeconds: 600 }, 429),
    ) as jest.Mock;
    await render(<Help />);
    await fireEvent.press(screen.getByTestId('help-contact'));
    await fireEvent.changeText(screen.getByTestId('help-subject'), 'Frage');
    await fireEvent.changeText(screen.getByTestId('help-message'), 'Eine längere Frage zur App.');
    await fireEvent.press(screen.getByTestId('help-send'));
    await waitFor(() => expect(screen.getByTestId('help-error')).toBeTruthy());
    expect(screen.getByTestId('help-message').props.value).toBe('Eine längere Frage zur App.');
  });
});
