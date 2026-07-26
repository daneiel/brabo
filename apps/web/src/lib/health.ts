import type { HealthStatus } from '@brabo/shared';
import { runtimeConfig } from './runtime-config';

export const API_URL = runtimeConfig.apiUrl;
export const ENGINE_URL = runtimeConfig.engineUrl;

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
