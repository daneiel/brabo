import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addressableAgents, AGENTS, AREAS, SOLO_CONVERSATIONAL_AGENTS } from './agents';
import { lerTokens } from './contraste';

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

/**
 * A cor de agente é SEMPRE token (AT-284, ADR 0181): hex solto não muda com o
 * tema, e foi assim que três agentes ficaram lavados no claro.
 */
describe('cor de agente vem do design system', () => {
  const css = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');
  const raiz = lerTokens(css, ':root');

  it('caminho feliz: todo agente pinta com var(--token) que existe em design/tokens.css', () => {
    for (const def of Object.values(AGENTS)) {
      const m = /^var\((--[\w-]+)\)$/.exec(def.color);
      expect(m, `${def.key} usa "${def.color}", não um var(--token)`).not.toBeNull();
      expect(raiz[m![1]], `${def.key}: ${m![1]} não existe no :root`).toBeDefined();
    }
  });

  it('falha: um hex solto seria recusado pela mesma régua', () => {
    expect(/^var\((--[\w-]+)\)$/.exec('#5EBEB1')).toBeNull();
  });
});
