/**
 * Friendly Captcha v2 EU API hosts, as the SDK uses them with `apiEndpoint: 'eu'` (it falls back from eu
 * to eu0 and eu1). The widget runs in an iframe from these hosts and talks to them, so every CSP that
 * shows the widget needs them in both frame-src and connect-src.
 */
export const FRC_EU_HOSTS = 'https://eu.frcapi.com https://eu0.frcapi.com https://eu1.frcapi.com';
