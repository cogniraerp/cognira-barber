import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { setLanguage } from '@/lib/i18n';

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const next = i18n.language.startsWith('en') ? 'es' : 'en';
  return (
    <Button variant="ghost" size="sm" onClick={() => setLanguage(next)} aria-label={t('app.language')}>
      <Languages aria-hidden /> {next.toUpperCase()}
    </Button>
  );
}
