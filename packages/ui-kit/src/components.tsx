import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
}

/** Кнопка; `busy` блокирует повторное нажатие на время запроса. */
export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  busy,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      className="dm-button"
      data-variant={variant}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  error?: string | null;
  hint?: string;
  autoComplete?: string;
  maxLength?: number;
}

/** Поле ввода с подписью, подсказкой и ошибкой (связаны через `aria-describedby`). */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  error,
  hint,
  autoComplete,
  maxLength,
}: TextFieldProps) {
  const id = useId();
  const described =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="dm-field" data-invalid={error ? '' : undefined}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <span className="dm-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="dm-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="dm-toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

/** Ползунок; значение всегда в границах `min..max`. */
export function Slider({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  const id = useId();
  return (
    <div className="dm-field">
      <label htmlFor={id}>
        {label}: <output>{format ? format(value) : value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
      />
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="dm-panel" aria-label={title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Модальный диалог: фокус внутрь при открытии, `Escape` закрывает. */
export function Dialog({ title, open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('button, input, [tabindex]') ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dm-dialog-backdrop">
      <div
        className="dm-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface NoticeProps {
  tone?: 'info' | 'success' | 'warning' | 'error';
  children: ReactNode;
}

/** Уведомление: ошибки — `role=alert`, остальное — `role=status`. */
export function Notice({ tone = 'info', children }: NoticeProps) {
  return (
    <div className="dm-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Заполнитель загрузки. */
export function Skeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <div className="dm-skeleton" key={i} />
      ))}
    </div>
  );
}
