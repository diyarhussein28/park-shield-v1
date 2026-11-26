import type { SVGProps } from 'react';

/** Line icons (24 px grid, stroke 2), always decorative: the text next to them carries the meaning. */
const paths = {
  shield: 'M12 3 4 6v6c0 4.6 3.2 8.4 8 9.6 4.8-1.2 8-5 8-9.6V6l-8-3Z',
  shieldCheck: 'M12 3 4 6v6c0 4.6 3.2 8.4 8 9.6 4.8-1.2 8-5 8-9.6V6l-8-3Z M8.5 12l2.5 2.5 4.5-5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M11 18h2',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  eyeOff:
    'M3 3l18 18 M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.6 M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 1 1 8 0v4',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  qr: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M20 14v.01 M14 20v.01 M17 20h4v-3 M6 6v.01 M17 6v.01 M6 17v.01',
  check: 'M5 12.5 10 17 19 7',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  play: 'M7 4v16l13-8L7 4Z',
  pause: 'M7 4h3v16H7z M14 4h3v16h-3z',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M6 6l12 12 M18 6 6 18',
  plus: 'M12 5v14 M5 12h14',
  car: 'M5 17h14v-5l-2-5H7l-2 5v5Z M5 12h14 M7.5 17v2 M16.5 17v2 M8 14.5h.01 M16 14.5h.01',
  lightbulb:
    'M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z',
  cloudRain: 'M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3 M8 19v2 M12 17v4 M16 19v2',
  truck:
    'M2 6h12v10H2z M14 10h4l4 4v2h-8z M6.5 18.5a1.5 1.5 0 1 0 0-.01 M17.5 18.5a1.5 1.5 0 1 0 0-.01',
  globe:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
  home: 'M3 11 12 3l9 8 M5 10v10h5v-6h4v6h5V10',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 7v5l3 2',
  card: 'M2 5h20v14H2z M2 10h20 M6 15h4',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 20h16',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  database:
    'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10',
  chevronDown: 'M6 9l6 6 6-6',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  alert: 'M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      width={24}
      height={24}
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
