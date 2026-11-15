import { useId, type SVGProps } from 'react';

/** Line icons (24 px grid, stroke 2), always decorative: the text next to them carries the meaning. */
const paths = {
  home: 'M3 11 12 3l9 8 M5 10v10h5v-6h4v6h5V10',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7Z M16 8.5h.01',
  shield: 'M12 3 4 6v6c0 4.6 3.2 8.4 8 9.6 4.8-1.2 8-5 8-9.6V6l-8-3Z',
  flag: 'M4 22V4 M4 4h13l-2 4 2 4H4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  text: 'M4 7V5h16v2 M9 19h6 M12 5v14',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8Z M3 8l9 5 9-5 M12 13v8',
  handshake:
    'M11 17l2 2a1.4 1.4 0 0 0 2-2 M14 14l2.5 2.5a1.4 1.4 0 0 0 2-2L15 11 M3 11l5-5 4 2 3-2 6 5 M3 11l3 3 M12 8l-3 3a1.4 1.4 0 0 0 2 2l2-2',
  ticket: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z M14 7v10',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  userCog:
    'M10 15H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M19 16a2 2 0 1 0 0 .01 M19 12v2 M19 19v2 M15.5 14l1.7 1 M20.8 18l1.7 1 M15.5 20l1.7-1 M20.8 16l1.7-1',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
  alert: 'M12 3 2 20h20L12 3Z M12 10v4 M12 17h.01',
  check: 'M5 12.5 10 17 19 7',
  checkCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M8 12.5l2.7 2.7L16 10',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 7v5l3 2',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 1 1 8 0v4',
  card: 'M2 5h20v14H2z M2 10h20 M6 15h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-4 M12 8h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
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

/** The ParkShield mark (same as the website): a shield with a QR finder pattern. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
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
