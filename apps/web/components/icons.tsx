import { useId, type SVGProps } from 'react';

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

/** The ParkShield mark: a shield with a QR finder pattern. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId(); // header and footer both show the mark: gradient ids must not clash
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z"
        fill={`url(#${id})`}
      />
      <rect x="10" y="10" width="5" height="5" rx="1" fill="#fff" />
      <rect x="17" y="10" width="5" height="5" rx="1" fill="#facc15" />
      <rect x="10" y="17" width="5" height="5" rx="1" fill="#fff" />
      <rect x="17.5" y="17.5" width="2" height="2" fill="#fff" />
      <rect x="20.5" y="20.5" width="2" height="2" fill="#fff" />
    </svg>
  );
}
