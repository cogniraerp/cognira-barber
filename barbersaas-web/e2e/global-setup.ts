import { API_URL } from './support/api';

/** Falla rápido y con un mensaje claro si la API no está levantada. */
export default async function globalSetup(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/v1/health`);
    const body = (await res.json()) as { status?: string; db?: string };
    if (body.status !== 'ok' || body.db !== 'ok') throw new Error(JSON.stringify(body));
  } catch (e) {
    throw new Error(
      `La API no responde en ${API_URL} (${String(e)}).\n` +
        'Levántala antes de correr los E2E: cd ../barbersaas-api && docker compose --profile app up -d',
      { cause: e },
    );
  }
}
