import type { HealthStatus } from '@brabo/shared';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const ENGINE_URL =
  import.meta.env.VITE_ENGINE_URL ?? 'http://localhost:4000';

export async function fetchHealth(baseUrl: string): Promise<HealthStatus> {
  const response = await fetch(`${baseUrl}/health`);
  const body = (await response.json().catch(() => null)) as HealthStatus | null;

  if (!response.ok || !body) {
    return {
      service: baseUrl === API_URL ? 'api' : 'engine',
      status: 'error',
      timestamp: new Date().toISOString(),
      details: { httpStatus: response.status },
    };
  }

  return body;
}
