import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, render, unknownVariables, variablesInOrder } from './templates';

describe('plantillas', () => {
  it('render reemplaza variables (con o sin espacios)', () => {
    expect(render('Hola {{cliente}}, a las {{ hora }}', { cliente: 'Ana', hora: '10:00' })).toBe(
      'Hola Ana, a las 10:00',
    );
  });
  it('detecta variables desconocidas', () => {
    expect(unknownVariables('{{cliente}} {{nombre}} {{nombre}} {{hora}}')).toEqual(['nombre']);
  });
  it('orden de variables para parámetros posicionales', () => {
    expect(variablesInOrder('{{cliente}} {{fecha}} {{cliente}}')).toEqual([
      'cliente',
      'fecha',
      'cliente',
    ]);
  });
  it('las plantillas por defecto solo usan variables válidas', () => {
    for (const ev of Object.values(DEFAULT_TEMPLATES)) {
      for (const t of Object.values(ev))
        expect(unknownVariables(`${t.subject ?? ''} ${t.body}`)).toEqual([]);
    }
  });
});
