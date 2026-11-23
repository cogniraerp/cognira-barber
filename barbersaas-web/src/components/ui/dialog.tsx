import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal sobre <dialog> nativo: focus trap, Esc para cerrar y `inert` del resto los da el navegador.
 * Se monta solo mientras `open` es true.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn('m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-foreground shadow-xl backdrop:bg-slate-900/50', className)}
    >
      <div className="flex items-start justify-between gap-4 border-b p-5">
        <div className="grid gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto p-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t p-4">{footer}</div>}
    </dialog>
  );
}
