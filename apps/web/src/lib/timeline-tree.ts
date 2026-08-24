import type { SessionEvent } from './api-types';

/**
 * A linha do tempo de cada agente, em ÁRVORE.
 *
 * O feed cronológico existente responde "o que aconteceu"; ele não responde
 * "o que cada agente está fazendo AGORA" nem "o que este agente fez, do
 * começo ao fim, sem o barulho dos outros". Numa sessão com Criativo, PO,
 * Arquiteto e N devs, tudo chega misturado numa coluna só — que é como o
 * painel do time nasceu e por que ele não bastava.
 *
 * A árvore inverte o eixo: **agente** primeiro, tempo depois. Cada ramo é um
 * agente; dentro dele, os marcos em ordem; e no topo, em uma linha, o que ele
 * está fazendo neste instante.
 *
 * Deriva 100% do event log que a tela já busca — nenhum estado novo, nenhuma
 * rota nova. Se um evento não está aqui, é porque ninguém o gravou.
 */

export type MarcoTipo =
  | 'ativado'
  | 'resposta'
  | 'falha'
  | 'ferramenta'
  | 'artefato'
  | 'handoff'
  | 'delegacao'
  | 'trabalho'
  | 'gate';

export interface Marco {
  eventId: string;
  seq: number;
  tipo: MarcoTipo;
  rotulo: string;
  /** Detalhe curto — nome da ferramenta, destino do handoff, origem da falha. */
  detalhe?: string;
  em: string;
  /** Tipo CRU do evento (`tool.call`, `tool.result`, `agent.response`, …) —
   * decide o que o detalhe expandido do marco mostra, porque `tipo` (acima)
   * já funde `tool.call`/`tool.result` num `MarcoTipo` só. */
  eventType: string;
  /** Payload cru do evento — args da chamada, resultado da ferramenta,
   * conteúdo da resposta. Nunca despejado por padrão: só aparece quando o
   * marco é expandido individualmente. */
  payload: Record<string, unknown>;
  /**
   * Iteração do turno de ToolLoop a que este marco pertence, quando dá pra
   * saber. `agent.response` carrega `iteration` no payload (ToolLoop); quem
   * não carrega (agentes conversacionais fora do ToolLoop, como PO/Criativo)
   * ganha um contador PRÓPRIO por agente, incrementado a cada resposta —
   * é a inferência por proximidade que a árvore usa para agrupar visualmente.
   * `tool.call`/`tool.result` herdam a iteração da resposta que os originou,
   * porque no ToolLoop eles são despachados DEPOIS dela (ver tool_loop.ex).
   */
  iteracao?: number;
}

export interface RamoDeAgente {
  agente: string;
  marcos: Marco[];
  /** O que ele está fazendo AGORA, em uma frase. */
  agora: string;
  /** `true` enquanto o último marco não for um desfecho. */
  ativo: boolean;
  primeiroEm: string;
  ultimoEm: string;
  /** `seq` do marco mais recente — a régua de recência dos "5 últimos". */
  ultimoSeq: number;
}

/** Eventos que não pertencem a um agente — o tronco da árvore. */
const DA_SESSAO = new Set([
  'session.created',
  'session.activated',
  'session.closing',
  'session.closed',
  'session.closed_abnormally',
  'execution.activated',
  'chat.message',
]);

interface Traducao {
  tipo: MarcoTipo;
  rotulo: string;
  detalhe?: (p: Record<string, unknown>) => string | undefined;
}

const texto = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * De tipo de evento para marco. O que não está aqui NÃO vira nó: a árvore
 * mostra marcos, não o log inteiro — para isso já existe o log, que continua
 * a um clique.
 */
const TRADUCAO: Record<string, Traducao> = {
  'agent.activated': { tipo: 'ativado', rotulo: 'assumiu o trabalho' },
  'agent.response': { tipo: 'resposta', rotulo: 'respondeu' },
  'agent.error': {
    tipo: 'falha',
    rotulo: 'falhou',
    detalhe: (p) => texto(p.origem) && `origem ${texto(p.origem)}`,
  },
  'tool.call': {
    tipo: 'ferramenta',
    rotulo: 'usou ferramenta',
    detalhe: (p) => texto(p.tool),
  },
  'tool.result': {
    tipo: 'ferramenta',
    rotulo: 'ferramenta respondeu',
    detalhe: (p) => texto(p.tool),
  },
  'handoff.offered': {
    tipo: 'handoff',
    rotulo: 'ofereceu o trabalho',
    detalhe: (p) => texto(p.toAgent) && `→ ${texto(p.toAgent)}`,
  },
  'handoff.accepted': { tipo: 'handoff', rotulo: 'aceitou o trabalho' },
  'artifact.product_brief': { tipo: 'artefato', rotulo: 'emitiu o brief' },
  'artifact.business_rule': { tipo: 'artefato', rotulo: 'emitiu regra de negócio' },
  'artifact.module_map': { tipo: 'artefato', rotulo: 'emitiu o module_map' },
  'artifact.insight': { tipo: 'artefato', rotulo: 'emitiu hipótese' },
  'delegation.completed': {
    tipo: 'delegacao',
    rotulo: 'subagente concluiu',
    detalhe: (p) => texto(p.area),
  },
  'delegation.failed': {
    tipo: 'delegacao',
    rotulo: 'subagente falhou',
    detalhe: (p) => texto(p.failureOrigin) && `origem ${texto(p.failureOrigin)}`,
  },
  'delegation.dispensed': { tipo: 'delegacao', rotulo: 'dispensou a delegação' },
  'dev.started': { tipo: 'trabalho', rotulo: 'começou a task' },
  'dev.working': { tipo: 'trabalho', rotulo: 'trabalhando' },
  'dev.idle': { tipo: 'trabalho', rotulo: 'ocioso' },
  'dev.awaiting_approval': { tipo: 'trabalho', rotulo: 'esperando sua aprovação' },
  'dev.awaiting_gate': { tipo: 'gate', rotulo: 'esperando o gate' },
  'dev.blocked': {
    tipo: 'trabalho',
    rotulo: 'bloqueado',
    detalhe: (p) => texto(p.reason),
  },
  'dev.idle_tripped': { tipo: 'trabalho', rotulo: 'circuit breaker abriu' },
  'dev.rearmed': { tipo: 'trabalho', rotulo: 'rearmado por você' },
  'pr.gate_changed': {
    tipo: 'gate',
    rotulo: 'gate mudou',
    detalhe: (p) => texto(p.gate) ?? texto(p.status),
  },
};

/** Marcos que ENCERRAM um turno — depois deles o agente não está "fazendo". */
const DESFECHOS = new Set<MarcoTipo>(['resposta', 'falha', 'handoff']);

/**
 * Marcos com detalhe de execução por trás — args da chamada, resultado da
 * ferramenta, conteúdo/iteração da resposta. São os únicos que a árvore deixa
 * expandir individualmente; os demais (handoff, artefato, gate…) já dizem
 * tudo que têm na própria linha.
 */
export const EVENTOS_EXPANSIVEIS = new Set(['tool.call', 'tool.result', 'agent.response']);

export function marcoExpansivel(m: Marco): boolean {
  return EVENTOS_EXPANSIVEIS.has(m.eventType);
}

/**
 * A frase de "agora". Fala do ÚLTIMO marco, porque é ele que descreve o
 * presente — e diz explicitamente quando o agente está parado, em vez de
 * deixar o ramo mudo (que foi o defeito que originou tudo isto).
 */
function frasePresente(ultimo: Marco | undefined): { agora: string; ativo: boolean } {
  if (!ultimo) return { agora: 'ainda não entrou em ação', ativo: false };

  if (DESFECHOS.has(ultimo.tipo)) {
    if (ultimo.tipo === 'falha') {
      return { agora: `parou por falha${ultimo.detalhe ? ` (${ultimo.detalhe})` : ''}`, ativo: false };
    }
    if (ultimo.tipo === 'handoff') {
      return { agora: `passou adiante ${ultimo.detalhe ?? ''}`.trim(), ativo: false };
    }
    return { agora: 'terminou o turno', ativo: false };
  }

  const detalhe = ultimo.detalhe ? ` — ${ultimo.detalhe}` : '';
  return { agora: `${ultimo.rotulo}${detalhe}`, ativo: true };
}

export function montarArvore(events: SessionEvent[]): {
  ramos: RamoDeAgente[];
  tronco: Marco[];
} {
  const porAgente = new Map<string, Marco[]>();
  const tronco: Marco[] = [];
  // Estado de agrupamento por iteração, por agente — ver o comentário de
  // `Marco.iteracao`. `fallback` só avança para agente sem `iteration` real.
  const iteracaoPorAgente = new Map<string, { atual?: number; fallback: number }>();

  for (const evento of events) {
    const traducao = TRADUCAO[evento.type];
    const payload = (evento.payload ?? {}) as Record<string, unknown>;

    if (DA_SESSAO.has(evento.type)) {
      tronco.push({
        eventId: evento.id,
        seq: evento.seq,
        tipo: 'trabalho',
        rotulo: evento.type,
        em: evento.createdAt,
        eventType: evento.type,
        payload,
      });
      continue;
    }

    if (!traducao) continue;
    // Só evento COM dono vira ramo: um marco de `system` não pertence a
    // agente nenhum, e pendurá-lo num deles seria inventar autoria.
    if (evento.actor.kind !== 'agent') continue;

    const agente = evento.actor.id;
    const marcos = porAgente.get(agente) ?? [];
    const estadoIteracao = iteracaoPorAgente.get(agente) ?? { atual: undefined, fallback: 0 };
    if (traducao.tipo === 'resposta') {
      estadoIteracao.atual =
        typeof payload.iteration === 'number' ? payload.iteration : estadoIteracao.fallback++;
    }
    iteracaoPorAgente.set(agente, estadoIteracao);

    marcos.push({
      eventId: evento.id,
      seq: evento.seq,
      tipo: traducao.tipo,
      rotulo: traducao.rotulo,
      detalhe: traducao.detalhe?.(payload),
      em: evento.createdAt,
      eventType: evento.type,
      payload,
      iteracao: estadoIteracao.atual,
    });
    porAgente.set(agente, marcos);
  }

  const ramos: RamoDeAgente[] = [...porAgente.entries()].map(
    ([agente, marcos]) => {
      const ordenados = [...marcos].sort((a, b) => a.seq - b.seq);
      const { agora, ativo } = frasePresente(ordenados[ordenados.length - 1]);
      return {
        agente,
        marcos: ordenados,
        agora,
        ativo,
        primeiroEm: ordenados[0].em,
        ultimoEm: ordenados[ordenados.length - 1].em,
        ultimoSeq: ordenados[ordenados.length - 1].seq,
      };
    },
  );

  // Quem está ATIVO primeiro — a pergunta "quem está trabalhando agora" é a
  // que se faz olhando a tela; o histórico de quem parou pode esperar. Dentro
  // de cada grupo (ativo/parado), o mais RECENTE primeiro — é a ordem que
  // `ramosAbertosPorPadrao` usa pra decidir os "5 últimos".
  ramos.sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return b.ultimoSeq - a.ultimoSeq;
  });

  return { ramos, tronco };
}

/**
 * Quais ramos abrem expandidos por padrão.
 *
 * Critério: os 5 agentes com atividade mais RECENTE (maior `seq` do último
 * marco) — mas ativo continua tendo prioridade sobre recência, então um
 * ramo ainda em ação sempre abre, mesmo que existam mais de 5. Como
 * `ramos` (parâmetro) já vem ordenado por `montarArvore` com os ativos
 * primeiro e, dentro de cada grupo, do mais recente pro mais antigo, os
 * dois critérios colapsam numa fatia só: os primeiros
 * `max(nº de ativos, 5)` elementos.
 */
export function ramosAbertosPorPadrao(ramos: RamoDeAgente[]): Set<string> {
  const ativos = ramos.filter((r) => r.ativo).length;
  const quantos = Math.max(ativos, 5);
  return new Set(ramos.slice(0, quantos).map((r) => r.agente));
}

/** Um agente e suas instâncias, para quem precisa do segundo nível — ver `agruparPorInstancia`. */
export interface GrupoDeAgente {
  /** O `agent_id` do módulo, SEM o sufixo de instância extra (ex.: `dev-backend`). */
  agenteBase: string;
  /** 1 ou 2 ramos — nunca 0. Instância extra, quando existe, vem por ÚLTIMO. */
  instancias: RamoDeAgente[];
}

/**
 * Sufixo de subagente extra do MESMO módulo (paralelização, ADR 0053/RN-083).
 * Tem de bater com `extraDevAgentId` em
 * `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
 * — o teto é DOIS por módulo (RN-154), então o sufixo é sempre exatamente
 * `-2`, nunca uma sequência a inventar.
 */
const SUFIXO_INSTANCIA_EXTRA = /-2$/;

/**
 * Agrupa os ramos por AGENTE-BASE, revelando um segundo nível quando o mesmo
 * módulo tem duas instâncias (achado da Onda 1/frente B0 do PROGRAMA 28).
 *
 * A "instância" NÃO é um contador renumerado (`-01`/`-02`) — é o `agent_id`
 * REAL que o produto já escreve. `montarArvore` (acima) já agrupa por
 * `evento.actor.id`, então `dev-backend` e `dev-backend-2` já chegam aqui
 * como dois RAMOS separados; esta função só decide quais ramos pertencem ao
 * mesmo grupo visual. Um ramo só vira "instância extra" de outro se o
 * agente-base (sem o sufixo) TAMBÉM tiver um ramo na mesma lista — senão ele
 * É o próprio agente, mesmo terminando em "-2" por coincidência de nome (não
 * existe hoje, mas a checagem custa nada e evita adivinhação).
 *
 * A ordem dos grupos preserva a ordem de `ramos` (que `montarArvore` já
 * ordena: ativo primeiro, depois por recência) — usar o primeiro ramo
 * encontrado de cada grupo como âncora de posição é o que garante isso.
 */
export function agruparPorInstancia(ramos: RamoDeAgente[]): GrupoDeAgente[] {
  const porAgente = new Map(ramos.map((r) => [r.agente, r] as const));
  const jaAgrupados = new Set<string>();
  const grupos: GrupoDeAgente[] = [];

  for (const ramo of ramos) {
    if (jaAgrupados.has(ramo.agente)) continue;

    const ehInstanciaExtra =
      SUFIXO_INSTANCIA_EXTRA.test(ramo.agente) &&
      porAgente.has(ramo.agente.replace(SUFIXO_INSTANCIA_EXTRA, ''));
    if (ehInstanciaExtra) continue; // processado junto do agente-base, abaixo

    jaAgrupados.add(ramo.agente);
    const idExtra = `${ramo.agente}-2`;
    const extra = porAgente.get(idExtra);
    if (extra) jaAgrupados.add(idExtra);

    grupos.push({
      agenteBase: ramo.agente,
      instancias: extra ? [ramo, extra] : [ramo],
    });
  }

  return grupos;
}
