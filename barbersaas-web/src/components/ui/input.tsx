import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 placeholder:text-slate-400 focus:border-marca-600 focus:ring-2 focus:ring-marca-100 focus:outline-none aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:bg-slate-100 sm:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm leading-none font-medium text-slate-700', className)} {...props} />;
}

/** Campo accesible: label + input + ayuda/error enlazados por aria-describedby. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
