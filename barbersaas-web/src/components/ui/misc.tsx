import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-600',
      success: 'bg-emerald-50 text-emerald-700',
      warning: 'bg-amber-50 text-amber-800',
      danger: 'bg-red-50 text-red-700',
      info: 'bg-marca-50 text-marca-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({
  className,
  tone,
  ...p
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

export function Skeleton({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-slate-200/70', className)} {...p} />;
}

export function Spinner({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('text-muted-foreground flex items-center gap-2 text-sm', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Alert({
  children,
  title,
  tone = 'danger',
}: {
  children?: ReactNode;
  title: string;
  tone?: 'danger' | 'info';
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-xl border p-4 text-sm',
        tone === 'danger'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-marca-200 bg-marca-50 text-marca-900',
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-10 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}
