/**
 * CSV mínimo y sin dependencias (RFC 4180): comillas, comillas escapadas (""), saltos de línea
 * dentro de campos, BOM, y separador autodetectado (`,` `;` o tabulador — Excel en español usa `;`).
 */
export function parseCsv(text: string, maxRows = 10_000): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = [',', ';', '\t']
    .map((s) => ({ s, n: countOutsideQuotes(firstLine, s) }))
    .sort((a, b) => b.n - a.n)[0]!.s;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows) throw new Error(`Máximo ${maxRows} filas`);
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function countOutsideQuotes(line: string, sep: string): number {
  let n = 0;
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === sep && !q) n++;
  }
  return n;
}

/**
 * Serializa a CSV para Excel: BOM UTF-8, separador `,`, CRLF y protección contra
 * "CSV injection" (celdas que empiezan con = + - @ se prefijan con ' para que no se ejecuten como fórmula).
 */
export function toCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const cell = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (isFormulaLike(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * ¿Excel/Sheets interpretaría la celda como fórmula peligrosa? (OWASP CSV injection)
 * `=` `@` tab y CR siempre; `+` y `-` solo si no es un número/teléfono puro (+51 987 654 321, -5, 12.5).
 */
export function isFormulaLike(s: string): boolean {
  if (/^[=@\t\r]/.test(s)) return true;
  if (/^[+-]/.test(s)) return !/^[+-]?[\d\s().]+$/.test(s);
  return false;
}

/** "Teléfono " → "telefono" (para reconocer encabezados escritos de cualquier forma). */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
