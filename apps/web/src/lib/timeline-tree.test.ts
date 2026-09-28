import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agruparPorInstancia,
  CHAVES_DE_ROTULO_USADAS,
  marcoExpansivel,
  montarArvore,
  ramosAbertosPorPadrao,
} from './timeline-tree';
import type { SessionEvent } from './api-types';
import i18n from './i18n';
import executorsEn from '../locales/en/executors.json';
import executorsPtBR from '../locales/pt-BR/executors.json';

// Os rótulos saem de `i18n.t()` (AT-134). As asserções de frase abaixo foram
// escritas em pt-BR (a árvore nasceu nele), então a suíte roda em pt-BR e o
// bloco de `en` no fim troca de idioma só para si — `en` é o default do app.
beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

let seq = 0;
function evento(
  type: string,
  actor: { kind: string; id: string },
  payload: Record<string, unknown> = {},
): SessionEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 's1',
    seq,
    type,
    actor,
    payload,
    createdAt: new Date(2026, 7, 4, 12, 0, seq).toISOString(),
  } as SessionEvent;
}

const agente = (id: string) => ({ kind: 'agent', id });

/**
 * A árvore inverte o eixo do feed: agente primeiro, tempo depois. A pergunta
 * que ela responde — "o que cada um está fazendo AGORA" — não tinha resposta
 * numa coluna cronológica com quatro agentes falando junto.
 */
describe('montarArvore', () => {
  it('agrupa marcos por agente, em ordem', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('criativo')),
      evento('agent.activated', agente('po')),
      evento('agent.response', agente('criativo'), { content: 'oi' }),
    ]);

    const criativo = ramos.find((r) => r.agente === 'criativo')!;
    expect(criativo.marcos.map((m) => m.tipo)).toEqual(['ativado', 'resposta']);
    expect(ramos.map((r) => r.agente).sort()).toEqual(['criativo', 'po']);
  });

  it('diz o que o agente está fazendo agora, a partir do último marco', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('po')),
      evento('tool.call', agente('po'), { tool: 'create_story' }),
    ]);

    expect(ramos[0].agora).toBe('usou ferramenta — create_story');
    expect(ramos[0].ativo).toBe(true);
  });

  /** Ramo mudo era o defeito de origem: silêncio não pode ser um estado. */
  it('agente que só foi ativado diz que ainda não agiu, não fica em branco', () => {
    const { ramos } = montarArvore([evento('agent.activated', agente('criativo'))]);

    expect(ramos[0].agora).toBe('assumiu o trabalho');
    expect(ramos[0].marcos).toHaveLength(1);
  });

  it('desfecho encerra: resposta, falha e handoff deixam o ramo inativo', () => {
    const comResposta = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.response', agente('a'), {}),
    ]);
    const comFalha = montarArvore([
      evento('agent.activated', agente('b')),
      evento('agent.error', agente('b'), { origem: 'infra' }),
    ]);
    const comHandoff = montarArvore([
      evento('agent.activated', agente('c')),
      evento('handoff.offered', agente('c'), { toAgent: 'po' }),
    ]);

    expect(comResposta.ramos[0]).toMatchObject({ ativo: false, agora: 'terminou o turno' });
    expect(comFalha.ramos[0]).toMatchObject({ ativo: false });
    expect(comFalha.ramos[0].agora).toContain('origem infra');
    expect(comHandoff.ramos[0].agora).toContain('→ po');
  });

  /** Quem está trabalhando AGORA é a pergunta da tela; histórico pode esperar. */
  it('ordena os ativos antes dos parados', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('parado')),
      evento('agent.response', agente('parado'), {}),
      evento('agent.activated', agente('trabalhando')),
      evento('tool.call', agente('trabalhando'), { tool: 'x' }),
    ]);

    expect(ramos.map((r) => r.agente)).toEqual(['trabalhando', 'parado']);
  });

  /** Marco sem dono não pode ser pendurado num agente: seria inventar autoria. */
  it('evento de system ou de user não vira ramo de agente', () => {
    const { ramos, tronco } = montarArvore([
      evento('chat.message', { kind: 'user', id: 'u-1' }, { text: 'oi' }),
      evento('execution.activated', { kind: 'user', id: 'u-1' }, {}),
      evento('pr.gate_changed', { kind: 'system', id: 'gate' }, { gate: 'awaiting_qa' }),
    ]);

    expect(ramos).toEqual([]);
    expect(tronco.length).toBeGreaterThan(0);
  });

  /**
   * AT-087, a sequência medida numa instalação real: `dev.started` seguido de
   * `dev.blocked_by_container`. O bloqueio sumia (sem tradução) e o ramo
   * parava em "começou a task", ATIVO — trabalho afirmado sobre um agente
   * parado esperando o container subir.
   */
  it('dev bloqueado por container: o bloqueio vira marco com o motivo, e o ramo NÃO fica ativo', () => {
    const reason = 'o projeto não tem container REGISTRADO como `running` (RN-502)';
    const { ramos } = montarArvore([
      evento('dev.started', agente('dev-backend'), { agentId: 'dev-backend', module: 'backend' }),
      evento('dev.blocked_by_container', agente('dev-backend'), {
        agentId: 'dev-backend',
        module: 'backend',
        reason,
      }),
    ]);

    const ramo = ramos[0];
    expect(ramo.marcos.map((m) => m.eventType)).toEqual(['dev.started', 'dev.blocked_by_container']);
    expect(ramo.marcos[1]).toMatchObject({ tipo: 'espera', detalhe: reason });
    expect(ramo.ativo).toBe(false);
    expect(ramo.agora).toContain(reason);
    expect(ramo.agora).not.toMatch(/começou|trabalhando/);
  });

  it('`dev.started` não afirma task: ele sai ANTES do claim', () => {
    const { ramos } = montarArvore([evento('dev.started', agente('dev-backend'), {})]);

    expect(ramos[0]).toMatchObject({ agora: 'procurando task', ativo: true });
  });

  /** O ativo da árvore é o `trabalhando` do painel — uma decisão, não duas. */
  it('estado `dev.*` que o painel não chama de trabalho deixa o ramo parado', () => {
    const parados = ['dev.idle', 'dev.blocked', 'dev.awaiting_gate', 'dev.awaiting_approval', 'dev.idle_tripped'];
    for (const tipo of parados) {
      const { ramos } = montarArvore([evento(tipo, agente('dev-x'), { reason: 'r' })]);
      expect({ tipo, ativo: ramos[0].ativo }).toEqual({ tipo, ativo: false });
    }
    const { ramos } = montarArvore([
      evento('dev.working', agente('dev-x'), { taskTitle: 'Cadastro de cliente' }),
    ]);
    expect(ramos[0]).toMatchObject({ ativo: true, agora: 'trabalhando — Cadastro de cliente' });
  });

  it('`dev.error` é falha com o motivo, e encerra', () => {
    const { ramos } = montarArvore([
      evento('dev.error', agente('infra-lead'), { reason: 'claim recusado' }),
    ]);

    expect(ramos[0]).toMatchObject({ ativo: false });
    expect(ramos[0].agora).toContain('claim recusado');
  });

  it('evento sem tradução não vira nó — a árvore mostra marcos, não o log', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('algum.evento.novo', agente('a'), {}),
    ]);

    expect(ramos[0].marcos).toHaveLength(1);
  });

  it('sessão sem evento nenhum devolve árvore vazia, não quebra', () => {
    expect(montarArvore([])).toEqual({ ramos: [], tronco: [] });
  });

  /**
   * `tool.call`/`tool.result` não carregam `iteration` no payload (só
   * `agent.response` carrega, via ToolLoop) — o agrupamento por iteração é
   * inferido pela PROXIMIDADE de `seq`: os marcos de ferramenta pertencem à
   * resposta imediatamente ANTERIOR, porque é ela quem os despachou.
   */
  it('agrupa tool.call/tool.result na iteração do agent.response que os despachou', () => {
    const { ramos } = montarArvore([
      evento('agent.response', agente('dev-backend'), { iteration: 0 }),
      evento('tool.call', agente('dev-backend'), { tool: 'read_file', args: { path: 'a.ex' } }),
      evento('tool.result', agente('dev-backend'), { tool: 'read_file', ok: true, result: 'conteúdo' }),
      evento('agent.response', agente('dev-backend'), { iteration: 1 }),
      evento('tool.call', agente('dev-backend'), { tool: 'write_file', args: { path: 'b.ex' } }),
    ]);

    const marcos = ramos[0].marcos;
    expect(marcos.map((m) => m.iteracao)).toEqual([0, 0, 0, 1, 1]);
  });

  /** Agente fora do ToolLoop (PO/Criativo) não tem `iteration` no payload —
   * ganha um contador PRÓPRIO, incrementado a cada resposta, pra ainda dar
   * pra desenhar a fronteira entre turnos. */
  it('infere iteração por um contador próprio quando o payload não carrega `iteration`', () => {
    const { ramos } = montarArvore([
      evento('agent.response', agente('po'), { content: 'primeiro turno' }),
      evento('tool.call', agente('po'), { tool: 'create_story' }),
      evento('agent.response', agente('po'), { content: 'segundo turno' }),
    ]);

    expect(ramos[0].marcos.map((m) => m.iteracao)).toEqual([0, 0, 1]);
  });

  it('marco sem dono de iteração (antes da primeira resposta) fica sem `iteracao`', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('criativo')),
    ]);

    expect(ramos[0].marcos[0].iteracao).toBeUndefined();
  });

  it('só tool.call/tool.result/agent.response são expansíveis', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.response', agente('a'), { iteration: 0 }),
      evento('tool.call', agente('a'), { tool: 'x' }),
      evento('handoff.offered', agente('a'), { toAgent: 'po' }),
    ]);

    const porTipo = new Map(ramos[0].marcos.map((m) => [m.eventType, marcoExpansivel(m)]));
    expect(porTipo.get('agent.activated')).toBe(false);
    expect(porTipo.get('agent.response')).toBe(true);
    expect(porTipo.get('tool.call')).toBe(true);
    expect(porTipo.get('handoff.offered')).toBe(false);
  });
});

describe('ramosAbertosPorPadrao', () => {
  /**
   * Critério A: os 5 agentes com atividade mais RECENTE abrem por padrão.
   * `montarArvore` já ordena os ramos com os mais recentes primeiro (dentro
   * de cada grupo ativo/parado) — a função só corta a fatia.
   */
  it('abre os 5 mais recentes quando ninguém está ativo', () => {
    const eventos: SessionEvent[] = [];
    const nomes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const nome of nomes) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {})); // encerra o ramo — todos "parados"
    }
    const { ramos } = montarArvore(eventos);

    // 7 agentes criados em ordem a..g — g é o de maior `seq` (mais recente),
    // a é o de menor. Os 5 últimos são c, d, e, f, g; a e b ficam de fora.
    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['c', 'd', 'e', 'f', 'g']));
  });

  it('agente ATIVO sempre abre, mesmo sendo o mais ANTIGO — prioridade sobre recência', () => {
    const eventos: SessionEvent[] = [
      evento('agent.activated', agente('velho-ativo')),
      evento('tool.call', agente('velho-ativo'), { tool: 'x' }), // segue ativo
    ];
    for (const nome of ['a', 'b', 'c', 'd', 'e']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {})); // parado
    }
    const { ramos } = montarArvore(eventos);

    // Total aberto continua 5 (o "5 últimos" não vira "5 + os ativos"), mas
    // quem preenche a fatia muda: o ativo entra garantido mesmo sendo o mais
    // ANTIGO de todos, empurrando pra fora o parado mais antigo (`a`).
    const abertos = ramosAbertosPorPadrao(ramos);
    expect(abertos).toEqual(new Set(['velho-ativo', 'b', 'c', 'd', 'e']));
  });

  it('mais de 5 agentes ativos: todos abrem, sem corte', () => {
    const eventos: SessionEvent[] = [];
    for (const nome of ['a', 'b', 'c', 'd', 'e', 'f']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('tool.call', agente(nome), { tool: 'x' })); // todos ATIVOS
    }
    const { ramos } = montarArvore(eventos);

    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f']));
  });

  it('com poucos agentes, todos abrem — não há corte artificial', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('a')),
      evento('agent.activated', agente('b')),
    ]);

    expect(ramosAbertosPorPadrao(ramos)).toEqual(new Set(['a', 'b']));
  });
});

/**
 * A "instância" (achado da Onda 1/frente B0 do PROGRAMA 28, RN-198): não é
 * um contador renumerado — é o `agent_id` real que o produto já escreve
 * (`dev-backend`/`dev-backend-2`, `extraDevAgentId` em
 * `activate-execution.use-case.ts`), e `montarArvore` já os separa em dois
 * ramos por agrupar `evento.actor.id`. `agruparPorInstancia` só decide quais
 * ramos formam um grupo visual de dois níveis.
 */
describe('agruparPorInstancia', () => {
  it('agente sem sufixo -2 vira grupo de UMA instância', () => {
    const { ramos } = montarArvore([evento('agent.activated', agente('criativo'))]);

    const grupos = agruparPorInstancia(ramos);

    expect(grupos).toEqual([{ agenteBase: 'criativo', instancias: [ramos[0]] }]);
  });

  it('dev-backend e dev-backend-2 viram UM grupo com DUAS instâncias, base primeiro', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('dev-backend-2')),
      evento('agent.activated', agente('dev-backend')),
    ]);

    const grupos = agruparPorInstancia(ramos);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].agenteBase).toBe('dev-backend');
    expect(grupos[0].instancias.map((r) => r.agente)).toEqual(['dev-backend', 'dev-backend-2']);
  });

  it('agente terminado em -2 SEM o par de base vira grupo próprio, não instância de ninguém', () => {
    // Não existe hoje (o teto é sempre dev-<modulo> + dev-<modulo>-2), mas a
    // função não deve adivinhar um agente-base que não está na lista.
    const { ramos } = montarArvore([evento('agent.activated', agente('modulo-2'))]);

    const grupos = agruparPorInstancia(ramos);

    expect(grupos).toEqual([{ agenteBase: 'modulo-2', instancias: [ramos[0]] }]);
  });

  it('múltiplos agentes independentes: um grupo por agente-base, ordem preservada', () => {
    const { ramos } = montarArvore([
      evento('agent.activated', agente('dev-backend')),
      evento('agent.activated', agente('po')),
      evento('agent.activated', agente('dev-backend-2')),
    ]);

    const grupos = agruparPorInstancia(ramos);

    expect(grupos.map((g) => g.agenteBase).sort()).toEqual(['dev-backend', 'po']);
    const devBackend = grupos.find((g) => g.agenteBase === 'dev-backend')!;
    expect(devBackend.instancias).toHaveLength(2);
  });
});

/**
 * AT-134: os rótulos da árvore passam pelo i18n, nos dois idiomas. A DECISÃO
 * por tipo continua em `TRADUCAO` (e é ela que
 * `scripts/ci/vocabulario-de-eventos-dev.spec.ts` cobra); o que se prova aqui
 * é a outra metade — que toda chave que a tabela usa tem TEXTO em `en` e em
 * `pt-BR`, e que o idioma trocado troca a frase.
 */
describe('rótulos da árvore no i18n (AT-134)', () => {
  type Subarvore = {
    label: Record<string, string>;
    now: Record<string, string>;
    detail: Record<string, string>;
  };
  const en = executorsEn.timelineTree as unknown as Subarvore;
  const ptBR = executorsPtBR.timelineTree as unknown as Subarvore;

  it('toda chave de rótulo que `TRADUCAO` usa tem texto nos dois idiomas', () => {
    expect(CHAVES_DE_ROTULO_USADAS.length).toBeGreaterThanOrEqual(25);
    const semEn = CHAVES_DE_ROTULO_USADAS.filter((c) => !en.label[c]?.trim());
    const semPt = CHAVES_DE_ROTULO_USADAS.filter((c) => !ptBR.label[c]?.trim());
    expect({ semEn, semPt }).toEqual({ semEn: [], semPt: [] });
  });

  it('`label`, `now` e `detail` têm as MESMAS chaves em `en` e `pt-BR`', () => {
    for (const bloco of ['label', 'now', 'detail'] as const) {
      expect({ bloco, chaves: Object.keys(ptBR[bloco]).sort() }).toEqual({
        bloco,
        chaves: Object.keys(en[bloco]).sort(),
      });
    }
  });

  it('nenhum rótulo sobra nos locales sem ser usado pela tabela', () => {
    const usadas = CHAVES_DE_ROTULO_USADAS as readonly string[];
    expect(Object.keys(en.label).filter((c) => !usadas.includes(c))).toEqual([]);
  });

  it('o idioma passado como argumento vence o ativo — é ele que o `useMemo` observa', () => {
    // A suíte está em pt-BR aqui; o argumento pede `en`.
    const { ramos } = montarArvore([evento('dev.started', agente('dev-x'))], 'en');
    expect(ramos[0].agora).toBe('looking for a task');
    const { ramos: emPt } = montarArvore([evento('dev.started', agente('dev-x'))]);
    expect(emPt[0].agora).toBe('procurando task');
  });

  describe('em `en` (o idioma default, RN-425)', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('en');
    });
    afterAll(async () => {
      await i18n.changeLanguage('pt-BR');
    });

    it('rótulo e frase do presente saem em inglês', () => {
      const { ramos } = montarArvore([
        evento('agent.activated', agente('po')),
        evento('tool.call', agente('po'), { tool: 'create_story' }),
      ]);
      expect(ramos[0].marcos.map((m) => m.rotulo)).toEqual(['took over the work', 'used a tool']);
      expect(ramos[0].agora).toBe('used a tool — create_story');
    });

    it('desfechos e o detalhe de origem também', () => {
      const falha = montarArvore([evento('agent.error', agente('b'), { origem: 'infra' })]);
      const handoff = montarArvore([evento('handoff.offered', agente('c'), { toAgent: 'po' })]);
      const fim = montarArvore([evento('agent.response', agente('a'), {})]);

      expect(falha.ramos[0].agora).toBe('stopped due to a failure (origin infra)');
      expect(handoff.ramos[0].agora).toBe('handed off → po');
      expect(fim.ramos[0].agora).toBe('finished the turn');
    });

    it('dev bloqueado por container não fala português', () => {
      const { ramos } = montarArvore([
        evento('dev.blocked_by_container', agente('dev-backend'), { reason: 'no container' }),
      ]);
      expect(ramos[0].marcos[0].rotulo).toBe('stopped: the project has no running container');
      expect(ramos[0].agora).toBe(
        'stopped: the project has no running container — no container',
      );
    });
  });
});
