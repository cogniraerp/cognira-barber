import { useQueryClient } from '@tanstack/react-query';
import {
  getPlatformWhatsAppControllerStatusQueryKey,
  platformWhatsAppControllerDisconnect,
  platformWhatsAppControllerQr,
  usePlatformWhatsAppControllerStatus,
} from '@/api/generated/endpoints';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/table';
import { QrLink } from '@/components/whatsapp/qr-link';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';

/** El número de WhatsApp de Cognira (avisos a las barberías: cobranza, reactivación), vinculado por QR. */
export function PlatformWhatsAppPage() {
  const qc = useQueryClient();
  const q = usePlatformWhatsAppControllerStatus();
  const refresh = () => qc.invalidateQueries({ queryKey: getPlatformWhatsAppControllerStatusQueryKey() });
  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <PageHeader title="WhatsApp de Cognira" subtitle="El número con el que la plataforma avisa a las barberías (cobranza, suspensión y reactivación)." />
      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : null}
      {!q.data ? (
        <Skeleton className="h-48" />
      ) : (
        <Card>
          <CardHeader><CardTitle>Número de la plataforma</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {!q.data.evolutionConfigured ? (
              <Alert tone="info" title="WhatsApp con QR no está configurado">Define EVOLUTION_URL y EVOLUTION_API_KEY en el servidor (Coolify) y vuelve a desplegar.</Alert>
            ) : (
              <>
                {q.data.provider !== 'evolution' && (
                  <Alert tone="info" title="La plataforma todavía envía con Meta (Cloud API)">
                    Para usar este número, define WHATSAPP_PLATFORM_PROVIDER=evolution en el servidor. Puedes vincularlo antes.
                  </Alert>
                )}
                <QrLink
                  phone={q.data.phone}
                  connected={q.data.state === 'open'}
                  requestQr={() => platformWhatsAppControllerQr()}
                  disconnect={async () => { await platformWhatsAppControllerDisconnect(); await refresh(); }}
                  onLinked={() => void refresh()}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
