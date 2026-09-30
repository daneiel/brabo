import { describe, expect, it } from 'vitest';
import type { ProvisioningStatus } from './api-types';
import {
  INTERVALO_DO_BOOTSTRAP_MS,
  bootstrapTerminou,
  pollDoBootstrap,
} from './poll-do-bootstrap';

function query(
  status: ProvisioningStatus | null,
  estado: 'pending' | 'error' | 'success' = 'success',
) {
  return { state: { status: estado, data: status === null ? null : { status } } };
}

describe('poll do bootstrap (AT-302)', () => {
  it('caminho feliz: enquanto provisiona, polla a 3 s — não mais a 1 s', () => {
    const poll = pollDoBootstrap({ paraNaFalha: true });
    expect(INTERVALO_DO_BOOTSTRAP_MS).toBe(3000);
    expect(poll(query('provisioning'))).toBe(3000);
    // Sem linha de bootstrap ainda (`null`) também acompanha: ela está nascendo.
    expect(poll(query(null))).toBe(3000);
  });

  it('para quando converge, nas duas telas', () => {
    expect(pollDoBootstrap({ paraNaFalha: true })(query('provisioned'))).toBe(false);
    expect(pollDoBootstrap({ paraNaFalha: false })(query('provisioned'))).toBe(false);
  });

  it('falha: para onde nada a retoma (adoção), segue onde o retry precisa ver o bootstrap novo (provisionamento)', () => {
    expect(pollDoBootstrap({ paraNaFalha: true })(query('provision_failed'))).toBe(false);
    expect(pollDoBootstrap({ paraNaFalha: false })(query('provision_failed'))).toBe(3000);
  });

  it('a query que ERROU para de pollar (pollQueParaNoErro), mesmo sem estado terminal', () => {
    expect(pollDoBootstrap({ paraNaFalha: false })(query('provisioning', 'error'))).toBe(false);
  });

  it('`bootstrapTerminou` é a mesma régua que para os eventos', () => {
    expect(bootstrapTerminou('provisioned', { paraNaFalha: false })).toBe(true);
    expect(bootstrapTerminou('provision_failed', { paraNaFalha: false })).toBe(false);
    expect(bootstrapTerminou('provision_failed', { paraNaFalha: true })).toBe(true);
    expect(bootstrapTerminou(undefined, { paraNaFalha: true })).toBe(false);
  });
});
