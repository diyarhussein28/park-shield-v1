import { clsx } from 'clsx';
import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const buttonVariants = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-secondary text-secondary-fg hover:brightness-95',
  danger: 'bg-danger text-danger-fg hover:brightness-110',
  ghost: 'bg-transparent text-primary underline-offset-4 hover:underline',
} as const;

const buttonSizes = {
  // 48 px minimum touch target (SC-12)
  md: 'min-h-12 px-5 text-base',
  lg: 'min-h-16 px-6 text-lg',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  block?: boolean;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  busy,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        buttonVariants[variant],
        buttonSizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('mx-auto w-full max-w-3xl px-4', className)} {...rest} />;
}

export function Stack({
  gap = 4,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { gap?: 2 | 3 | 4 | 6 | 8 }) {
  const gaps = { 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8' } as const;
  return <div className={clsx('flex flex-col', gaps[gap], className)} {...rest} />;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('rounded-2xl border border-border bg-surface p-5 shadow-sm', className)}
      {...rest}
    />
  );
}

const headingSizes = { 1: 'text-3xl', 2: 'text-2xl', 3: 'text-xl' } as const;

export function Heading({
  level = 2,
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 }) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={clsx('font-bold tracking-tight', headingSizes[level], className)} {...rest} />
  );
}

export function Text({
  muted,
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & { muted?: boolean }) {
  return <p className={clsx(muted && 'text-muted', className)} {...rest} />;
}

const badgeTones: Record<Tone | 'neutral', string> = {
  neutral: 'bg-secondary text-secondary-fg',
  info: 'bg-info-bg text-info-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-text',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone | 'neutral' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold',
        badgeTones[tone],
        className,
      )}
      {...rest}
    />
  );
}

const noticeTones: Record<Tone, string> = {
  info: 'bg-info-bg text-info-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-text',
};

/** Status message. `danger` is announced assertively (role=alert), the rest politely (role=status). */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx('rounded-xl px-4 py-3', noticeTones[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div>{children}</div>}
    </div>
  );
}

const control =
  'block w-full rounded-xl border border-border-strong bg-bg px-4 text-base text-fg placeholder:text-muted aria-[invalid=true]:border-danger';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optionalLabel?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Label + control + hint/error wired with aria-describedby. */
export function Field({ label, hint, error, optionalLabel, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
        {optionalLabel && <span className="ml-1 font-normal text-muted">({optionalLabel})</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-semibold text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={clsx(control, 'min-h-12', className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea className={clsx(control, 'min-h-28 py-3', className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return <select className={clsx(control, 'min-h-12', className)} {...rest} />;
}

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={clsx('flex min-h-12 cursor-pointer items-center gap-3', className)}>
      <input type="checkbox" className="size-6 accent-[var(--ps-primary)]" {...rest} />
      {/* min-w-0: a flex item never shrinks below its longest word otherwise (reflow at 320 px). */}
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function SkipLink({ href = '#main', children }: { href?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="sr-only rounded-lg bg-primary px-4 py-3 text-primary-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
    >
      {children}
    </a>
  );
}
