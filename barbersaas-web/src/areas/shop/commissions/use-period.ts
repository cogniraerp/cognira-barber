import { PERIOD_LABEL, periodRange, type PeriodKey } from '@/lib/period';
import { useListParams } from '@/lib/use-list-params';
import { useNow } from '@/lib/use-now';
import { useShop } from '../shop-context';

/** Período en la URL (?periodo=mes | rango&desde&hasta). Por defecto, esta semana. */
export function usePeriod() {
  const tz = useShop().barbershop.timezone;
  const L = useListParams(20);
  const now = useNow(60_000);
  const raw = L.get('periodo') as PeriodKey;
  const key: PeriodKey = raw && raw in PERIOD_LABEL ? raw : 'semana';
  const range = periodRange(key, tz, new Date(now), { desde: L.get('desde'), hasta: L.get('hasta') });
  return { L, key, range };
}

