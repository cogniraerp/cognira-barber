import { MessageSquareReply } from 'lucide-react';
import { useState } from 'react';
import type { ComplaintListDto, ComplaintListDtoItemsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { COMPLAINT_STATUS, type ComplaintFilter } from './complaint-status';

const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

/**
 * Bandeja del Libro de Reclamaciones (barbería o plataforma): hojas con su plazo y respuesta.
 * La consulta y la respuesta las pone cada página (endpoints distintos).
 */
export function ComplaintsInbox({ data, error, filter, onFilter, page, onPage, respond, canRespond = true }: {
  data: ComplaintListDto | undefined;
  error: unknown;
  filter: ComplaintFilter;
  onFilter: (f: ComplaintFilter) => void;
  page: number;
  onPage: (p: number) => void;
  respond: (id: string, response: string) => Promise<unknown>;
  canRespond?: boolean;
}) {
  const [answering, setAnswering] = useState<ComplaintListDtoItemsItem | null>(null);
  return (
    <div className="grid gap-4">
      {data && data.overdueCount > 0 && (
        <Alert title={`${data.overdueCount} ${data.overdueCount === 1 ? 'hoja venció' : 'hojas vencieron'} sin respuesta`}>
          El plazo legal es de 15 días hábiles. Responde cuanto antes: INDECOPI puede multar por no hacerlo.
        </Alert>
      )}
      <Tabs
        label="Filtrar hojas"
        idBase="complaints"
        value={filter}
        onChange={onFilter}
        items={[
          { id: 'pending', label: 'Por responder', badge: data?.pendingCount ? <Badge tone="warning">{data.pendingCount}</Badge> : undefined },
          { id: 'answered', label: 'Respondidas' },
          { id: 'all', label: 'Todas' },
        ]}
      />
      {error ? <Alert title={errorMessage(error, i18n.t)} /> : null}
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {data && !data.items.length ? (
        <EmptyState title={filter === 'pending' ? 'Nada por responder' : 'Sin hojas'} description="Las hojas que registren tus clientes aparecerán aquí y te avisaremos por correo." />
      ) : null}
      <ul className="grid gap-3">
        {data?.items.map((c) => {
          const S = COMPLAINT_STATUS[c.status === 'answered' ? 'answered' : c.overdue ? 'overdue' : 'pending'];
          return (
            <li key={c.id} className="grid gap-3 rounded-xl border bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{c.code}</span>
                <Badge tone={c.kind === 'reclamo' ? 'info' : 'neutral'}>{c.kind === 'reclamo' ? 'Reclamo' : 'Queja'}</Badge>
                <Badge tone={S.tone}><S.icon className="mr-1 size-3" aria-hidden />{S.label}</Badge>
                <span className="text-slate-500">
                  {fmt.format(new Date(c.createdAt))}
                  {c.status === 'pending' && ` · responder hasta el ${fmt.format(new Date(c.dueAt))}`}
                </span>
                {canRespond && c.status === 'pending' && (
                  <Button size="sm" className="ml-auto" onClick={() => setAnswering(c)}><MessageSquareReply aria-hidden /> Responder</Button>
                )}
              </div>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className="inline text-slate-500">Consumidor: </dt><dd className="inline">{c.consumerName} · {c.docType} {c.docNumber}</dd></div>
                <div><dt className="inline text-slate-500">Contacto: </dt><dd className="inline">{c.consumerEmail}{c.consumerPhone ? ` · ${c.consumerPhone}` : ''}</dd></div>
                {c.guardianName && <div><dt className="inline text-slate-500">Apoderado: </dt><dd className="inline">{c.guardianName}</dd></div>}
                <div><dt className="inline text-slate-500">{c.itemType === 'producto' ? 'Producto' : 'Servicio'}: </dt><dd className="inline">{c.itemDescription}{c.amountCents != null ? ` · ${formatMoney(c.amountCents)}` : ''}</dd></div>
              </dl>
              <div className="grid gap-1">
                <p><span className="text-slate-500">Detalle: </span>{c.detail}</p>
                <p><span className="text-slate-500">Pedido: </span>{c.request}</p>
              </div>
              {c.response && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Respuesta del {c.respondedAt ? fmt.format(new Date(c.respondedAt)) : ''}</p>
                  <p className="whitespace-pre-line">{c.response}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={onPage} />}
      {answering && <RespondDialog complaint={answering} respond={respond} onClose={() => setAnswering(null)} />}
    </div>
  );
}

function RespondDialog({ complaint: c, respond, onClose }: {
  complaint: ComplaintListDtoItemsItem;
  respond: (id: string, response: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async () => {
    setPending(true);
    setError(null);
    try {
      await respond(c.id, text.trim());
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Responder ${c.code}`}
      description={`Se enviará por correo a ${c.consumerEmail}. Queda registrada y no se puede cambiar.`}
      className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} disabled={text.trim().length < 10} onClick={() => void send()}>Enviar respuesta</Button></>}
    >
      <div className="grid gap-3">
        {error ? <Alert title={errorMessage(error, i18n.t)} /> : null}
        <p className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-500">Pedido: </span>{c.request}</p>
        <Field label="Respuesta" hint="Explica qué harás o por qué no procede. Mínimo 10 caracteres.">
          {(p) => <Textarea {...p} rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
