import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  useProfileControllerAddGallery,
  useProfileControllerGetBranding,
  useProfileControllerGetProfile,
  useProfileControllerListGallery,
  useProfileControllerRemoveGallery,
  useProfileControllerUpdateBranding,
} from '@/api/generated/endpoints';
import type { UpdateBrandingDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { contrastRatio, readableOn } from '@/lib/contrast';
import { ImageUpload, Section } from './shared';
import { failed, saved, useRefreshShop } from './shared-utils';

const FONTS = [
  ['inter', 'Inter (moderna)'], ['poppins', 'Poppins'], ['montserrat', 'Montserrat'], ['playfair-display', 'Playfair Display (clásica)'],
  ['oswald', 'Oswald'], ['roboto', 'Roboto'], ['lora', 'Lora'], ['bebas-neue', 'Bebas Neue (urbana, solo títulos)'],
] as const;

export function BrandingForm({ onSaved }: { onSaved?: () => void }) {
  const branding = useProfileControllerGetBranding({ query: {} });
  const profile = useProfileControllerGetProfile({ query: {} });
  if (!branding.data || !profile.data) return <Skeleton className="h-96" />;
  const { primaryForeground: _a, secondaryForeground: _b, ...initial } = branding.data;
  return <BrandingEditor initial={initial} shopName={profile.data.name} onSaved={onSaved} />;
}

function BrandingEditor({ initial, shopName, onSaved }: { initial: UpdateBrandingDto; shopName: string; onSaved?: () => void }) {
  const refresh = useRefreshShop();
  const update = useProfileControllerUpdateBranding({ mutation: { onSuccess: async () => { await refresh(); saved(); onSaved?.(); }, onError: failed } });
  const [f, setF] = useState<UpdateBrandingDto>(initial);

  const primary = f.primaryColor ?? '#111827';
  const fg = readableOn(primary);
  const lowContrast = contrastRatio(primary, '#ffffff') < 3; // botones de marca sobre fondo blanco
  const set = (patch: Partial<UpdateBrandingDto>) => setF({ ...f, ...patch });
  const socials = f.socials ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ data: f });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-4">
          <Section title="Logo e imágenes">
            <div className="flex flex-wrap gap-6">
              <ImageUpload kind="logo" label="Logo" value={f.logoUrl} onChange={(logoUrl) => set({ logoUrl })} />
              <ImageUpload kind="banner" label="Portada" shape="wide" value={f.bannerUrl} onChange={(bannerUrl) => set({ bannerUrl })} />
              <ImageUpload kind="favicon" label="Favicon" value={f.faviconUrl} onChange={(faviconUrl) => set({ faviconUrl })} />
            </div>
          </Section>
          <Section title="Colores y tipografía">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label="Color principal" value={primary} onChange={(primaryColor) => set({ primaryColor })} />
              <ColorField label="Color secundario" value={f.secondaryColor ?? '#d4a373'} onChange={(secondaryColor) => set({ secondaryColor })} />
              <Field label="Tipografía de títulos">{(p) => <Select {...p} value={f.font ?? 'inter'} onChange={(e) => set({ font: e.target.value as UpdateBrandingDto['font'] })}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
              <Field label="Modo">{(p) => <Select {...p} value={f.theme ?? 'light'} onChange={(e) => set({ theme: e.target.value as UpdateBrandingDto['theme'] })}><option value="light">Claro</option><option value="dark">Oscuro</option><option value="system">Según el dispositivo</option></Select>}</Field>
            </div>
            {lowContrast && <Alert tone="info" title="Color muy claro">Los botones con este color se verán poco sobre fondo blanco. Considera un tono más oscuro.</Alert>}
          </Section>
          <Section title="Mensaje y redes">
            <Field label="Mensaje de bienvenida">{(p) => <Textarea {...p} value={f.welcomeMessage ?? ''} onChange={(e) => set({ welcomeMessage: e.target.value || null })} maxLength={500} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['instagram', 'tiktok', 'facebook', 'whatsapp'] as const).map((k) => (
                <Field key={k} label={k === 'whatsapp' ? 'WhatsApp' : k[0]!.toUpperCase() + k.slice(1)}>
                  {(p) => <Input {...p} value={socials[k] ?? ''} onChange={(e) => set({ socials: { ...socials, [k]: e.target.value || null } })} placeholder={k === 'whatsapp' ? '+51 987 654 321' : '@tubarberia'} />}
                </Field>
              ))}
              <Field label="Sitio web">{(p) => <Input {...p} type="url" value={socials.website ?? ''} onChange={(e) => set({ socials: { ...socials, website: e.target.value || null } })} placeholder="https://" />}</Field>
            </div>
          </Section>
        </div>

        {/* Vista previa en vivo */}
        <aside aria-label="Vista previa" className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Vista previa</p>
          <div className="overflow-hidden rounded-xl border shadow-sm">
            <div className="p-5" style={{ background: f.bannerUrl ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url(${f.bannerUrl}) center/cover` : primary, color: f.bannerUrl ? '#fff' : fg }}>
              {f.logoUrl && <img src={f.logoUrl} alt="" className="mb-3 size-12 rounded-lg object-cover" />}
              <p className="text-xl font-bold">{shopName}</p>
              {f.welcomeMessage && <p className="mt-1 text-sm opacity-90">{f.welcomeMessage}</p>}
            </div>
            <div className="grid gap-2 bg-white p-4 text-black">
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>Corte clásico</span><span className="font-semibold">S/ 35.00</span></div>
              <button type="button" className="h-10 rounded-md text-sm font-medium" style={{ background: primary, color: fg }}>Reservar</button>
            </div>
          </div>
        </aside>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={update.isPending}>Guardar marca</Button></div>
      <Gallery />
    </form>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      {(p) => (
        <div className="flex items-center gap-2">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 cursor-pointer rounded-md border p-1" aria-label={`${label} (selector)`} />
          <Input {...p} value={value} onChange={(e) => onChange(e.target.value)} pattern="#[0-9a-fA-F]{6}" className="font-mono" />
        </div>
      )}
    </Field>
  );
}

function Gallery() {
  const qc = useQueryClient();
  const list = useProfileControllerListGallery({ query: {} });
  const done = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/shop/gallery') });
  const add = useProfileControllerAddGallery({ mutation: { onSuccess: done, onError: failed } });
  const remove = useProfileControllerRemoveGallery({ mutation: { onSuccess: done, onError: failed } });
  return (
    <Section title="Galería de trabajos" description="Fotos de cortes que se muestran en tu página pública.">
      <div className="flex flex-wrap gap-3">
        {list.data?.map((g) => (
          <div key={g.id} className="relative">
            <img src={g.url} alt={g.caption ?? 'Trabajo'} className="size-24 rounded-lg object-cover" />
            <Button variant="outline" size="icon" className="absolute -top-2 -right-2 size-7 rounded-full bg-background" onClick={() => remove.mutate({ id: g.id })} aria-label="Quitar foto"><Trash2 aria-hidden /></Button>
          </div>
        ))}
        <ImageUpload kind="gallery" label="Agregar foto" value={null} onChange={(url) => url && add.mutate({ data: { url } })} />
      </div>
    </Section>
  );
}
