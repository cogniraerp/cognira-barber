import { MessageCircleWarning } from 'lucide-react';
import { Link } from 'react-router';
import { useShopNotificationsControllerGetWhatsApp } from '@/api/generated/endpoints';

/** El WhatsApp de la barbería (QR) se desvinculó: los mensajes quedan para enviarse a mano. */
export function WhatsAppDisconnectedBanner({ slug }: { slug: string }) {
  const q = useShopNotificationsControllerGetWhatsApp({ query: { staleTime: 5 * 60_000 } });
  const d = q.data;
  if (!d || d.provider !== 'evolution' || d.status !== 'error') return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-red-50 px-4 py-2 text-sm text-red-800">
      <MessageCircleWarning className="size-4 shrink-0" aria-hidden />
      <span>
        <strong>Tu WhatsApp se desconectó.</strong> Las confirmaciones y los recordatorios quedan en el Registro para enviarse a mano.
      </span>
      <Link to={`/s/${slug}/mensajes`} className="font-medium underline underline-offset-4">Volver a escanear el QR</Link>
    </div>
  );
}
