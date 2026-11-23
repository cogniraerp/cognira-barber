import { describe, expect, it } from 'vitest';
import { isFormulaLike, normalizeHeader, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('comas, comillas, comillas escapadas y saltos de línea dentro de un campo', () => {
    const csv = 'nombre,notas\r\n"Pérez, Juan","dice ""hola""\ny adiós"\r\nAna,\r\n';
    expect(parseCsv(csv)).toEqual([
      ['nombre', 'notas'],
      ['Pérez, Juan', 'dice "hola"\ny adiós'],
      ['Ana', ''],
    ]);
  });
  it('autodetecta ; (Excel en español) y tabulador; ignora BOM y filas vacías', () => {
    expect(parseCsv('\uFEFFnombre;telefono\nAna;987\n\n')).toEqual([
      ['nombre', 'telefono'],
      ['Ana', '987'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('límite de filas', () => {
    expect(() => parseCsv('a\n1\n2\n3', 2)).toThrow(/Máximo 2/);
  });
});

describe('toCsv', () => {
  it('BOM, escapado y protección contra fórmulas', () => {
    const out = toCsv(
      ['nombre', 'nota', 'n'],
      [
        ['=HYPERLINK("http://x")', 'a,b', -5],
        ['+51 999', '@cmd', null],
      ],
    );
    expect(out.startsWith('\uFEFF')).toBe(true);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")",`);
    expect(out).toContain('"a,b",-5');
    expect(out).toContain("+51 999,'@cmd,");
  });
  it('ida y vuelta', () => {
    const rows = [['Pérez, Juan', 'línea 1\nlínea 2']];
    expect(parseCsv(toCsv(['a', 'b'], rows)).slice(1)).toEqual(rows);
  });
});

describe('isFormulaLike', () => {
  it.each(['=1+1', '@SUM(A1)', '+cmd|"/c calc"!A1', '-2+3', '\tx'])('peligrosa: %s', (v) =>
    expect(isFormulaLike(v)).toBe(true),
  );
  it.each(['+51 987 654 321', '+51987654321', '-5', '12.5', 'Juan', '(01) 555-1234'])(
    'segura: %s',
    (v) => expect(isFormulaLike(v)).toBe(false),
  );
});

describe('normalizeHeader', () => {
  it('quita tildes, espacios y mayúsculas', () =>
    expect(normalizeHeader(' Teléfono Móvil ')).toBe('telefonomovil'));
});
