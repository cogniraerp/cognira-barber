import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, MailCheck, MailWarning, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { usePlatformUsersControllerResetLink, usePlatformUsersControllerVerifyEmail } from '@/api/generated/endpoints';
import type { ResetLinkDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';

const failed = (e: unknown) => toast.error(errorMessage(e, i18n.t));
const fmt = new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', timeZone: 'America/Lima' });

/** Estado del correo de un miembro (siempre icono + texto). */
export function EmailBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="success"><MailCheck className="mr-1 size-3" aria-hidden />Correo verificado</Badge>
  ) : (
    <Badge tone="warning"><MailWarning className="mr-1 size-3" aria-hidden />Correo sin verificar</Badge>
  );
}

/**
 * Vía manual (superadmin) mientras el correo no llega: confirmar el correo del usuario y generar un
 * enlace para que elija su contraseña, para enviárselo por WhatsApp.
 */
export function MemberAccountActions({ userId, verified, name }: { userId: string; verified: boolean; name: string }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<ResetLinkDto | null>(null);
  const verify = useMemberVerify(qc);
  const reset = usePlatformUsersControllerResetLink({ mutation: { onSuccess: setLink, onError: failed } });
  return (
    <>
      {!verified && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" loading={verify.isPending} onClick={() => verify.mutate({ id: userId })}>
          <MailCheck aria-hidden /> Verificar correo
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" loading={reset.isPending} onClick={() => reset.mutate({ id: userId })}>
        <KeyRound aria-hidden /> Enlace de contraseña
      </Button>
      {link && <ResetLinkDialog link={link} name={name} onClose={() => setLink(null)} />}
    </>
  );
}

function useMemberVerify(qc: ReturnType<typeof useQueryClient>) {
  return usePlatformUsersControllerVerifyEmail({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/platform/barbershops') });
        toast.success('Correo marcado como verificado');
      },
      onError: failed,
    },
  });
}

function ResetLinkDialog({ link, name, onClose }: { link: ResetLinkDto; name: string; onClose: () => void }) {
  const copy = async () => { await navigator.clipboard.writeText(link.url); toast.success('Enlace copiado'); };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Hola ${name}, entra a este enlace para elegir tu contraseña de Cognira Barber (vence en 1 hora): ${link.url}`)}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Enlace para elegir contraseña"
      description={`Para ${link.email}. Sirve una sola vez y vence a las ${fmt.format(new Date(link.expiresAt))}. Generar otro anula este.`}
      className="max-w-lg"
      footer={<Button variant="ghost" onClick={onClose}>Cerrar</Button>}
    >
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Input readOnly value={link.url} aria-label="Enlace" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="outline" onClick={() => void copy()}><Copy aria-hidden /> Copiar</Button>
        </div>
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:underline">
          <MessageCircle className="size-4" aria-hidden /> Enviar por WhatsApp
        </a>
        <p className="text-xs text-slate-500">No compartas este enlace en grupos: quien lo abra puede cambiar la contraseña de esta cuenta.</p>
      </div>
    </Dialog>
  );
}
