/// <reference types="node" />
// Único arquivo do app que lê o filesystem em tempo de teste — o resto de
// `src/` é browser puro (tsconfig.app.json's `types` de propósito não inclui
// `node`, pra não mascarar um `process`/`fs` usado por engano em código que
// RODA no navegador). A referência tripla-slash escopa `@types/node` só a
// este arquivo, sem alargar o app inteiro.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyEvent, isMachineEvent } from './activity';
import type { SessionEvent } from './api-types';

/**
 * Alimenta o teste com o catálogo GERADO de eventos (`pnpm docs:generate`,
 * `scripts/docs/generate.mjs`'s `gerarEventos()`) — o mesmo mecanismo que o
 * gerador usa pra cruzar prosa com código, aplicado aqui como "tradutor vs
 * catálogo": tipo novo sem entrada em `classifyEvent` quebra este teste, em
 * vez de vazar o identificador cru pro humano em runtime.
 *
 * `process.cwd()` (não `import.meta.url`) porque o vitest deste pacote roda
 * com cwd = `apps/web` tanto localmente (`pnpm exec vitest`) quanto via
 * `pnpm --filter web test` — `import.meta.url` neste ambiente não é uma URL
 * `file://` de verdade.
 */
const EVENTS_MD_PATH = join(process.cwd(), '..', '..', 'docs/reference/events.md');

const BEGIN_MARKER = '<!-- BEGIN:GENERATED:eventos-inventario -->';
const END_MARKER = '<!-- END:GENERATED:eventos-inventario -->';

function tiposDoCatalogo(): string[] {
  const conteudo = readFileSync(EVENTS_MD_PATH, 'utf8');
  const inicio = conteudo.indexOf(BEGIN_MARKER);
  const fim = conteudo.indexOf(END_MARKER);
  if (inicio === -1 || fim === -1) {
    throw new Error(
      `Não achei o bloco gerado em docs/reference/events.md — rode "pnpm docs:generate" ` +
        `e confira se os marcadores ${BEGIN_MARKER}/${END_MARKER} ainda existem.`,
    );
  }
  const bloco = conteudo.slice(inicio, fim);
  const tipos = [...bloco.matchAll(/^- `([a-z_]+\.[a-z_]+)`/gm)].map((m) => m[1]);
  return tipos;
}

let seq = 0;
function fixtureEvent(type: string): SessionEvent {
  seq += 1;
  return {
    id: `cat-${seq}`,
    sessionId: 'sess-catalogo',
    seq,
    type,
    actor: { kind: 'agent', id: 'ator-de-teste' },
    payload: {},
    createdAt: new Date().toISOString(),
  };
}

describe('classifyEvent — cobertura do catálogo gerado de eventos', () => {
  const tipos = tiposDoCatalogo();

  it('o catálogo não está vazio — se estiver, o parsing do bloco gerado quebrou', () => {
    expect(tipos.length).toBeGreaterThan(0);
  });

  it.each(tipos)('%s tem tradução própria — nunca vaza o tipo cru', (tipo) => {
    const evento = fixtureEvent(tipo);
    if (isMachineEvent(evento)) {
      // Evento de máquina: nunca aparece no feed, não faz sentido humanizar.
      return;
    }
    const { text } = classifyEvent(evento);
    expect(text).not.toContain(tipo);
  });
});
