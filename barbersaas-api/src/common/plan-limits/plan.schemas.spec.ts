import { describe, expect, it } from 'vitest';
import { parseFeatures, parseLimits } from './plan.schemas';

describe('parseLimits', () => {
  it('claves ausentes = ilimitado', () => {
    expect(parseLimits({ staff: 3 })).toMatchObject({ staff: 3, services: null });
  });
  it('un override vacío o ausente NO cambia los límites del plan', () => {
    expect(parseLimits({ staff: 2 }, {}).staff).toBe(2);
    expect(parseLimits({ staff: 2 }, null).staff).toBe(2);
    expect(parseLimits({ staff: 2 }, { services: 5 })).toMatchObject({ staff: 2, services: 5 });
  });

  it('el override puede volver ilimitado un límite (null explícito)', () => {
    expect(parseLimits({ staff: 2 }, { staff: null }).staff).toBeNull();
  });

  it('el override de la suscripción gana', () => {
    expect(parseLimits({ staff: 3 }, { staff: 10 }).staff).toBe(10);
  });
  it('JSON inválido no rompe: se usan los valores por defecto', () => {
    expect(parseLimits('basura').staff).toBeNull();
    expect(parseLimits({ staff: 3 }, { staff: 'x' }).staff).toBe(3);
  });
});

describe('parseFeatures', () => {
  it('por defecto todo desactivado', () => {
    expect(parseFeatures({ loyalty: true })).toMatchObject({ loyalty: true, api: false });
  });
});
