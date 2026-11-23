import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';

/** Confirmación de acciones sensibles con motivo obligatorio (queda en la auditoría). */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={pending} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error && <Alert title={error} />}
        <Field label="Motivo" hint="Queda registrado en la auditoría.">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500} />}</Field>
      </div>
    </Dialog>
  );
}
