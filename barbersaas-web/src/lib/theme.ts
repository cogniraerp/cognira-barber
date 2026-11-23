/** Aplica la marca de una barbería como variables CSS (tema dinámico). */
export interface BrandTheme {
  primaryColor: string;
  primaryForeground: string;
  secondaryColor?: string;
  font?: string;
}

const FONT_FAMILIES: Record<string, string> = {
  inter: 'Inter',
  poppins: 'Poppins',
  montserrat: 'Montserrat',
  'playfair-display': 'Playfair Display',
  oswald: 'Oswald',
  roboto: 'Roboto',
  lora: 'Lora',
  'bebas-neue': 'Bebas Neue',
};

export function applyBrandTheme(el: HTMLElement, theme: BrandTheme | null): void {
  if (!theme) {
    for (const v of ['--brand', '--brand-foreground', '--accent', '--font-brand']) el.style.removeProperty(v);
    return;
  }
  el.style.setProperty('--brand', theme.primaryColor);
  el.style.setProperty('--brand-foreground', theme.primaryForeground);
  if (theme.secondaryColor) el.style.setProperty('--accent', theme.secondaryColor);
  const family = theme.font ? FONT_FAMILIES[theme.font] : undefined;
  if (family) {
    // Con respaldo sans-serif: si la fuente aún no cargó (o no hay red), no cae en Times.
    el.style.setProperty('--font-brand', `'${family}', 'Inter', ui-sans-serif, system-ui, sans-serif`);
    loadGoogleFont(family);
  }
}

function loadGoogleFont(family: string): void {
  const id = `font-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}
