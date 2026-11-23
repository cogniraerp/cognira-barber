import { defineConfig } from 'orval';

/**
 * Genera tipos + hooks de TanStack Query desde el contrato de la API.
 * El frontend nunca importa código del backend: solo este contrato (openapi.json).
 */
export default defineConfig({
  api: {
    input: { target: './openapi.json' },
    output: {
      mode: 'split',
      target: 'src/api/generated/endpoints.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      formatter: 'prettier',
      override: {
        mutator: { path: 'src/api/http.ts', name: 'apiFetch' },
        query: { signal: true },
        // Las funciones devuelven el cuerpo directamente (no { data, status, headers }).
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
});
