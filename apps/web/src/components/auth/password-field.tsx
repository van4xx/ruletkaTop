'use client';

/**
 * Password input with a show/hide toggle and an optional strength meter.
 *
 * Forwards a ref to the underlying `<input>` so it composes with
 * react-hook-form's `register`. The visibility toggle is a real button with an
 * accessible label; the strength meter is a 4-segment bar driven by a light
 * heuristic (length + character-class variety) and is purely advisory.
 */
import { forwardRef, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input, type InputProps } from '@ruletka/ui';
import { cn } from '@/lib/cn';

export interface PasswordFieldProps extends Omit<InputProps, 'type' | 'leadingIcon' | 'trailingIcon'> {
  /** Show the 4-segment strength meter below the field. */
  showStrength?: boolean;
  /** Current value (only needed when `showStrength` is on). */
  value?: string;
}

/** 0–4 strength score from length + character-class variety. */
export function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: 'Слишком короткий', tone: 'bg-destructive' },
  { label: 'Слабый', tone: 'bg-destructive' },
  { label: 'Средний', tone: 'bg-warning' },
  { label: 'Хороший', tone: 'bg-[var(--color-neon-cyan)]' },
  { label: 'Надёжный', tone: 'bg-success' },
] as const;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { showStrength = false, value = '', className, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const score = scorePassword(value);
  const meta = STRENGTH[score] ?? STRENGTH[0];

  return (
    <div className="flex flex-col gap-2">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        leadingIcon={<Lock />}
        className={className}
        trailingIcon={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
            aria-pressed={visible}
            className="pointer-events-auto inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        {...props}
      />
      {showStrength && value.length > 0 && (
        <div className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-300',
                  i < score ? meta.tone : 'bg-border',
                )}
              />
            ))}
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{meta.label}</span>
        </div>
      )}
    </div>
  );
});
