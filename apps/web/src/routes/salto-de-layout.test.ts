/// <reference types="node" />
// Lê o filesystem em tempo de teste, como `SessionPage.teto.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RN-816 (AT-480): o bloco que chega DEPOIS do primeiro paint (as pendências
 * de outras sessões, lidas da fila do projeto) não fica acima do botão nem
 * entre o fio e o composer — senão o botão muda de lugar sob o cursor e o
 * primeiro clique cai onde ele estava. jsdom não faz layout, então o que se
 * prova aqui é a posição relativa no JSX.
 */
function fonte(arquivo: string): string {
  return readFileSync(join(__dirname, arquivo), 'utf8');
}

describe('blocos tardios não empurram o botão (RN-816)', () => {
  it('Sessão: as pendências de outras sessões moram ACIMA do fio, não entre ele e o composer', () => {
    const s = fonte('SessionPage.tsx');
    const pendencias = s.indexOf('<PendenciasDeOutrasSessoes');
    expect(pendencias).toBeGreaterThan(-1);
    expect(pendencias).toBeLessThan(s.indexOf('className={styles.messages}'));
    expect(pendencias).toBeLessThan(s.indexOf('<SessionComposer'));
  });

  it('Executores: "Parar execução" e a oferta em lote vêm antes das pendências de outras sessões', () => {
    const s = fonte('ProjectExecutorsTab.tsx');
    const pendencias = s.indexOf('<PendenciasDeOutrasSessoes');
    expect(pendencias).toBeGreaterThan(-1);
    expect(s.indexOf('<PararExecucao')).toBeLessThan(pendencias);
    expect(s.indexOf('<ModoAutomaticoDoTime')).toBeLessThan(pendencias);
  });
});
