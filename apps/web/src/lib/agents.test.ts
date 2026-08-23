import { describe, it, expect } from 'vitest';
import { addressableAgents, AREAS, SOLO_CONVERSATIONAL_AGENTS } from './agents';

/**
 * Handoff manual a agente à escolha (ADR 0109/RN-440): `addressableAgents()`
 * povoa o seletor de "Endereçar handoff a..." em `SessionPage.tsx`. A
 * validação de VERDADE mora no backend (`RequestManualHandoffUseCase`); este
 * teste só garante que a lista da UI não some com um lead ou vaze um
 * subagente por engano.
 */
describe('addressableAgents (ADR 0109)', () => {
  it('contém todo lead de área e todo agente solo, sem duplicata', () => {
    const catalogo = addressableAgents();

    for (const area of Object.values(AREAS)) {
      expect(catalogo).toContain(area.lead);
    }
    for (const agente of SOLO_CONVERSATIONAL_AGENTS) {
      expect(catalogo).toContain(agente);
    }
    expect(new Set(catalogo).size).toBe(catalogo.length);
  });

  it('nunca contém um subagente de área', () => {
    const catalogo = addressableAgents();

    for (const area of Object.values(AREAS)) {
      for (const membro of area.members) {
        expect(catalogo).not.toContain(membro);
      }
    }
  });

  it('inclui o Staff (ADR 0088) — o caso real que motivou esta feature', () => {
    expect(addressableAgents()).toContain('staff');
  });
});
