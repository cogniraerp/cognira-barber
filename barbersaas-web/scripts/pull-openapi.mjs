// Descarga el contrato OpenAPI de la API en ejecución y lo guarda en ./openapi.json (versionado en este repo).
// Uso: pnpm api:pull  (por defecto http://localhost:3100/docs/openapi.json; o API_OPENAPI_URL=...)
import { writeFile } from 'node:fs/promises';

const url = process.env.API_OPENAPI_URL ?? 'http://localhost:3100/docs/openapi.json';
const res = await fetch(url);
if (!res.ok) {
  console.error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  process.exit(1);
}
const doc = await res.json();
await writeFile('openapi.json', JSON.stringify(doc, null, 2) + '\n');
console.log(`✔ openapi.json actualizado (${Object.keys(doc.paths ?? {}).length} rutas) desde ${url}`);
