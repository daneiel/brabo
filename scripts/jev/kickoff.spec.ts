import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kickoffDaQaAutomacao, kickoffDaQaEstrategia, kickoffDoAppsec, kickoffDoDev } from './kickoff.ts';

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'engine', 'lib', 'engine');
const fonte = (rel: string) => readFileSync(join(ENGINE, rel), 'utf8');

const historia = { id: 'h', title: 'Recorde', description: 'Guardar o recorde.', rf: ['RF um', 'RF dois'], rnf: ['RNF um'], dod: ['DoD um'] };
const modulos = [{ name: 'persistence', stack: 'TypeScript', responsibility: 'Guarda o recorde' }];

/**
 * A porta copia o TEXTO FIXO dos moldes do engine. Se o engine mudar a frase, o
 * kickoff da medição deixa de ser o que o produto mostraria — esta guarda a
 * âncora de cada molde contra o próprio arquivo Elixir.
 */
describe('a porta dos moldes do engine (texto fixo)', () => {
  it('dev_agent_server.ex: initial_message/2', () => {
    const src = fonte('dev/dev_agent_server.ex');
    const k = kickoffDoDev({ title: 'Persistir' }, { title: 'Recorde' });
    expect(k).toContain('Implemente a task "Persistir" da story "Recorde".');
    for (const trecho of [
      'Rode a suite de testes do projeto via `terminal` e só sinalize conclusão com',
      'Toda resposta sua deve conter pelo menos uma chamada de ferramenta.',
      '`report_blocked` com o diagnóstico do que foi tentado e por que falhou.',
    ]) {
      expect(src).toContain(trecho);
      expect(k.replace(/\n/g, ' ')).toContain(trecho.trim());
    }
  });

  it('qa_automacao_agent.ex: initial_message/2 numera as regras rf + rnf', () => {
    const src = fonte('gates/qa_automacao_agent.ex');
    const k = kickoffDaQaAutomacao({ title: 'T' }, historia);
    expect(k).toContain('1. RF um\n2. RF dois\n3. RNF um');
    for (const trecho of ['Você é a subespecialidade de Automação do gate de QA da task', 'Nunca chame as', 'funções do código que está revisando — elas não são ferramentas.']) {
      expect(src).toContain(trecho);
      expect(k).toContain(trecho);
    }
  });

  it('qa_estrategia_agent.ex: initial_message, com os arquivos da entrega (ADR 0192)', () => {
    const src = fonte('gates/qa_estrategia_agent.ex');
    const k = kickoffDaQaEstrategia({ title: 'Persistir' }, historia, ['src/recorde.ts', 'src/recorde.test.ts']);
    expect(k).toContain('o dev agent ENTREGOU a task "Persistir"');
    expect(k).toContain('- RF um\n- RF dois');
    expect(k).toContain('- src/recorde.ts\n- src/recorde.test.ts');
    for (const trecho of ['escreve o PLANO DE TESTE dessa entrega, a partir do código que existe', 'ARQUIVOS que a entrega tocou (git diff contra `dev`):', '`emit_plano_de_teste`. Responda SEMPRE chamando uma ferramenta.']) {
      expect(src).toContain(trecho);
      expect(k).toContain(trecho);
    }
  });

  it('qa_estrategia_agent.ex: a lista que não veio é dita, e a longa diz o total', () => {
    const src = fonte('gates/qa_estrategia_agent.ex');
    expect(src).toContain('(o diff contra `dev` veio vazio)');
    expect(kickoffDaQaEstrategia(null, historia, [])).toContain('(o diff contra `dev` veio vazio)');
    expect(kickoffDaQaEstrategia(null, historia, { erro: 'sem log' })).toContain('(não consegui listar: "sem log" — leia o worktree a partir da story)');
    const muitos = Array.from({ length: 45 }, (_, i) => `a${i}.ts`);
    expect(kickoffDaQaEstrategia(null, historia, muitos)).toContain('(e mais 5 de 45 no total)');
  });

  it('appsec_agent.ex: initial_message/2', () => {
    const src = fonte('gates/appsec_agent.ex');
    const k = kickoffDoAppsec(historia, modulos);
    for (const trecho of ['Você é o appsec — o SecOps num segundo momento, de DESIGN, ANTES de', 'lista vazia é resposta válida).', 'Responda SEMPRE chamando uma das ferramentas acima.']) {
      expect(src).toContain(trecho);
      expect(k).toContain(trecho);
    }
  });
});

describe('o que o log NÃO tem é dito, nunca inventado', () => {
  it('sem a história, o gate anterior ao código diz que ela não é recuperável', () => {
    expect(kickoffDaQaEstrategia(null, null, { erro: 'x' })).toContain('(story não recuperável do event log)');
    expect(kickoffDoAppsec(null, modulos)).toContain('(story não recuperável do event log)');
  });
});
