import { CalendarClock, CalendarCog, PartyPopper } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { BrandingForm } from './branding-form';
import { GeneralForm } from './general-form';
import { ExceptionsSection, HolidaysSection, HoursForm } from './hours-form';
import { MembersPage } from './members-page';
import { ProfileForm } from './profile-form';
import { RulesForm } from './rules-form';

export const ProfileSettings = () => <ProfileForm />;
export const BrandingSettings = () => <BrandingForm />;
const HOURS_TABS = [
  { id: 'semana', label: 'Horario semanal', icon: <CalendarClock aria-hidden /> },
  { id: 'feriados', label: 'Feriados', icon: <PartyPopper aria-hidden /> },
  { id: 'especiales', label: 'Días especiales', icon: <CalendarCog aria-hidden /> },
] as const;
type HoursTab = (typeof HOURS_TABS)[number]['id'];

/**
 * Horarios de la barbería (los heredan todos los barberos salvo que tengan uno propio):
 * semana, feriados y días especiales, en pestañas. La activa va en la URL (?seccion=feriados).
 */
export function HoursSettings() {
  const [sp, setSp] = useSearchParams();
  const idBase = 'horarios';
  const raw = sp.get('seccion');
  const tab: HoursTab = HOURS_TABS.some((t) => t.id === raw) ? (raw as HoursTab) : 'semana';
  const go = (id: HoursTab) => setSp(id === 'semana' ? {} : { seccion: id }, { replace: true });
  return (
    <div className="grid gap-4">
      <Tabs items={[...HOURS_TABS]} value={tab} onChange={go} label="Horarios" idBase={idBase} />
      <TabPanel idBase={idBase} id={tab}>
        {tab === 'semana' && <HoursForm />}
        {tab === 'feriados' && <HolidaysSection />}
        {tab === 'especiales' && <ExceptionsSection />}
      </TabPanel>
    </div>
  );
}
export const RulesSettings = () => <RulesForm />;
export const MembersSettings = () => <MembersPage />;
export const GeneralSettings = () => <GeneralForm />;
