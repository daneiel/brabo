import { describe, it, expect } from 'vitest';
import { readRuntimeConfig } from './runtime-config';

/**
 * A precedência é o contrato entre três coisas que não se enxergam: o
 * entrypoint do nginx (que escreve /config.js), o build do Vite (que inlina as
 * VITE_*) e o overlay do Kubernetes (que define as variáveis do container).
 *
 * O caso que mais importa é o da string vazia: `envsubst`/`printf` escrevem
 * `""` para variável não definida, e `'' ?? default` é `''` em JavaScript. Sem
 * o tratamento, um ConfigMap com uma chave faltando faz a app apontar para a
 * origem vazia e falhar com erro de CORS — que não diz nada sobre a causa real.
 */
describe('readRuntimeConfig', () => {
  it('usa o valor de runtime quando presente', () => {
    const config = readRuntimeConfig({
      apiUrl: 'https://api.brabo.example',
      engineUrl: 'https://engine.brabo.example',
      keycloakUrl: 'https://auth.brabo.example',
      keycloakRealm: 'brabo-prod',
      keycloakClientId: 'brabo-web-prod',
    });

    expect(config).toEqual({
      apiUrl: 'https://api.brabo.example',
      engineUrl: 'https://engine.brabo.example',
      keycloakUrl: 'https://auth.brabo.example',
      keycloakRealm: 'brabo-prod',
      keycloakClientId: 'brabo-web-prod',
    });
  });

  it('cai no default quando não há config de runtime — é o `pnpm dev:web`', () => {
    const config = readRuntimeConfig({});

    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.engineUrl).toBe('http://localhost:4000');
    expect(config.keycloakUrl).toBe('http://localhost:8080');
    expect(config.keycloakRealm).toBe('brabo-dev');
    expect(config.keycloakClientId).toBe('brabo-web');
  });

  it('trata string vazia como ausente, não como valor', () => {
    const config = readRuntimeConfig({ apiUrl: '', keycloakRealm: '   ' });

    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.keycloakRealm).toBe('brabo-dev');
  });

  it('resolve cada chave de forma independente', () => {
    const config = readRuntimeConfig({ apiUrl: 'https://api.brabo.example' });

    expect(config.apiUrl).toBe('https://api.brabo.example');
    expect(config.engineUrl).toBe('http://localhost:4000');
  });
});
