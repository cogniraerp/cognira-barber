import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 placeholder:text-slate-400 focus:border-marca-600 focus:ring-2 focus:ring-marca-100 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid=true]:border-destructive sm:text-sm';

/** Select con flecha propia y margen respecto al borde (la nativa queda pegada). */
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'select-chevron h-11 truncate pr-8', className)} {...p} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20', className)} {...p} />;
}

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 accent-marca-700" {...p} />
      {label}
    </label>
  );
}
