import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCustomersControllerImport } from '@/api/generated/endpoints';
import type { ImportResultDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { IMPORT_TEMPLATE } from './format';

const COLUMN_LABEL: Record<string, string> = { name: 'nombre', phone: 'teléfono', email: 'email', birthday: 'cumpleaños', tags: 'etiquetas', notes: 'notas' };

/**
 * Importar en dos pasos: primero se valida (dryRun) y se muestra qué pasará; luego se confirma.
 * Si ya existe un cliente con ese teléfono o email, se actualiza en vez de duplicarlo.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResultDtoOutput | null>(null);
  const run = useCustomersControllerImport();

  const check = (f: File) => {
    setFile(f);
    setPreview(null);
    run.mutate({ data: { file: f }, params: { dryRun: 'true' } }, { onSuccess: setPreview });
  };
  const confirm = () => {
    if (!file) return;
    run.mutate(
      { data: { file }, params: { dryRun: 'false' } },
      {
        onSuccess: async (r) => {
          await refresh();
          saved(`${r.created} creados, ${r.updated} actualizados`);
          onClose();
        },
      },
    );
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: 'plantilla-clientes.csv' }).click();
    URL.revokeObjectURL(url);
  };
  const ready = preview && preview.created + preview.updated > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Importar clientes"
      description="Desde Excel o Google Sheets: guarda como CSV. Si el teléfono o email ya existe, se actualiza ese cliente."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button>
          <Button disabled={!ready} loading={run.isPending && !!preview} onClick={confirm}>
            {ready ? `Importar ${preview.created + preview.updated}` : 'Importar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 text-sm">
        <label className="grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center hover:bg-muted/40">
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
          <span className="font-medium">{file ? file.name : 'Elegir archivo CSV'}</span>
          <span className="text-muted-foreground">Columnas: nombre, telefono, email, cumpleanos, etiquetas (separadas por ;), notas. Máx. 2 MB.</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); }} />
        </label>
        <Button variant="link" className="justify-self-start px-0" onClick={template}>Descargar plantilla de ejemplo</Button>

        {run.isPending && !preview && <p className="text-muted-foreground">Revisando el archivo…</p>}
        {run.error && <Alert title={errorMessage(run.error, t)} />}
        {preview && (
          <div className="grid gap-3">
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Nuevos', preview.created],
                ['Se actualizan', preview.updated],
                ['Se omiten', preview.skipped],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground">
              {preview.rows} filas · columnas reconocidas: {preview.columns.map((c) => COLUMN_LABEL[c] ?? c).join(', ') || 'ninguna'}
            </p>
            {preview.errors.length > 0 && (
              <Alert title={`${preview.errors.length} fila(s) con problemas (se omiten)`}>
                <ul className="mt-1 grid max-h-32 gap-0.5 overflow-y-auto">
                  {preview.errors.slice(0, 50).map((e) => <li key={e.row}>Fila {e.row}: {e.message}</li>)}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
