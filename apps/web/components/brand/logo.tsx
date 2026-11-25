import { useId } from 'react';
import { MARK_GRADIENT, MARK_SHIELD, MARK_SQUARES } from '@/lib/brand-mark';
import { cx } from '@/lib/cx';

/**
 * The ParkShield mark (shield with the QR finder squares) from the one definition in
 * `lib/brand-mark.ts`. Always decorative: the text next to it carries the name.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId(); // header and footer both show the mark: gradient ids must not clash
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={MARK_GRADIENT[0]} />
          <stop offset="1" stopColor={MARK_GRADIENT[1]} />
        </linearGradient>
      </defs>
      <path d={MARK_SHIELD} fill={`url(#${id})`} />
      {MARK_SQUARES.map(([x, y, s, r, fill]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={s} height={s} rx={r || undefined} fill={fill} />
      ))}
    </svg>
  );
}

const SIZES = {
  md: { gap: 'gap-2.5', mark: 'size-9', text: 'text-xl' },
  lg: { gap: 'gap-3', mark: 'size-11 sm:size-12', text: 'text-3xl sm:text-4xl' },
} as const;

/**
 * The logo: the mark and the „ParkShield“ wordmark. `onLight` for the header, `onDark` for the dark
 * footer (white „Park“, blue „Shield“). The mark is the same on both; on dark a faint white glow keeps
 * its edge visible without changing its shape.
 */
export function Logo({
  variant = 'onLight',
  size = 'md',
  className,
}: {
  variant?: 'onLight' | 'onDark';
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cx(
        'inline-flex items-center font-extrabold tracking-tight',
        s.gap,
        s.text,
        variant === 'onDark' && 'text-white',
        className,
      )}
    >
      <LogoMark
        className={cx(
          'shrink-0',
          s.mark,
          variant === 'onDark' && 'drop-shadow-[0_0_6px_rgba(255,255,255,0.18)]',
        )}
      />
      <span>
        Park<span className={variant === 'onDark' ? 'text-blue-500' : 'text-primary'}>Shield</span>
      </span>
    </span>
  );
}
