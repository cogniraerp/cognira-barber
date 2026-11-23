/**
 * Descarga un CSV generado por la API. `fetch().text()` quita el BOM UTF-8; se vuelve a poner
 * para que Excel lea bien tildes y ñ.
 */
export function downloadCsv(filename: string, csv: string): void {
  const text = csv.startsWith('\uFEFF') ? csv : `\uFEFF${csv}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
