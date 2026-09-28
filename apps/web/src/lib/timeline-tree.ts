import type { SessionEvent } from './api-types';
import { statusDoEventoDev } from './agent-status';
// A instância do i18n direto, com `ns` explícito — mesmo padrão de
// `agent-status.ts#descreverStatus`: `montarArvore` é função pura chamada
// fora de hook, e recebe o idioma como argumento (`getFixedT`).
import i18n from './i18n';

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
  | 'espera'
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

/**
 * A CHAVE do rótulo em `executors:timelineTree.label.*` (AT-134). A DECISÃO
 * por tipo — se vira nó, que `MarcoTipo`, que detalhe — continua aqui, no
 * código, e é ela que `scripts/ci/vocabulario-de-eventos-dev.spec.ts` lê; só
 * o TEXTO mora nos locales, nos dois idiomas. `timeline-tree.test.ts` reprova
 * chave desta união sem texto em `en` ou em `pt-BR`.
 */
export type ChaveDeRotulo =
  | 'agentActivated'
  | 'agentResponse'
  | 'agentError'
  | 'toolCall'
  | 'toolResult'
  | 'handoffOffered'
  | 'handoffAccepted'
  | 'artifactProductBrief'
  | 'artifactBusinessRule'
  | 'artifactModuleMap'
  | 'artifactModuleRouting'
  | 'artifactInsight'
  | 'delegationCompleted'
  | 'delegationFailed'
  | 'delegationDispensed'
  | 'devStarted'
  | 'devWorking'
  | 'devIdle'
  | 'devAwaitingApproval'
  | 'devAwaitingGate'
  | 'devBlocked'
  | 'devBlockedByContainer'
  | 'devError'
  | 'devIdleTripped'
  | 'prGateChanged';

interface Traducao {
  tipo: MarcoTipo;
  rotulo: ChaveDeRotulo;
  detalhe?: (p: Record<string, unknown>, t: Tradutor) => string | undefined;
}

const texto = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/** Texto da árvore num idioma FIXO — namespace `executors`, subárvore `timelineTree`. */
type Tradutor = (chave: string, opcoes?: Record<string, unknown>) => string;

function tradutorDaArvore(idioma: string | undefined): Tradutor {
  const t = i18n.getFixedT(idioma ?? i18n.language, 'executors');
  return (chave, opcoes = {}) => t(`timelineTree.${chave}`, opcoes);
}

/** "origem <x>" / "origin <x>" — o detalhe de falha e de delegação falhada. */
const comOrigem = (t: Tradutor, origem: string | undefined): string | undefined =>
  origem && t('detail.origin', { origem });

/**
 * De tipo de evento para marco. O que não está aqui NÃO vira nó: a árvore
 * mostra marcos, não o log inteiro — para isso já existe o log, que continua
 * a um clique.
 *
 * Para o vocabulário `dev.*` isso NÃO vale como omissão: todo tipo que o
 * engine emite tem de estar aqui ou em `TRADUCAO_FORA`, com o motivo, e
 * `scripts/ci/vocabulario-de-eventos-dev.spec.ts` reprova o que faltar. Foi
 * por omissão que `dev.blocked_by_container` sumia da árvore (AT-087): numa
 * instalação real o ramo parava em `dev.started`, e a frase do presente
 * afirmava trabalho sobre um agente parado esperando o container subir.
 *
 * `dev.rearmed` saiu desta tabela de propósito: quem o grava é a API, com
 * ator `user` (o clique do humano), e o filtro de `montarArvore` só pendura
 * marco de ator `agent` — a linha nunca produziu nó. O `dev.idle`/
 * `dev.working` que o rearm dispara no engine é o que aparece no ramo.
 */
const TRADUCAO: Record<string, Traducao> = {
  'agent.activated': { tipo: 'ativado', rotulo: 'agentActivated' },
  'agent.response': { tipo: 'resposta', rotulo: 'agentResponse' },
  'agent.error': {
    tipo: 'falha',
    rotulo: 'agentError',
    detalhe: (p, t) => comOrigem(t, texto(p.origem)),
  },
  'tool.call': {
    tipo: 'ferramenta',
    rotulo: 'toolCall',
    detalhe: (p) => texto(p.tool),
  },
  'tool.result': {
    tipo: 'ferramenta',
    rotulo: 'toolResult',
    detalhe: (p) => texto(p.tool),
  },
  'handoff.offered': {
    tipo: 'handoff',
    rotulo: 'handoffOffered',
    detalhe: (p) => texto(p.toAgent) && `→ ${texto(p.toAgent)}`,
  },
  'handoff.accepted': { tipo: 'handoff', rotulo: 'handoffAccepted' },
  'artifact.product_brief': { tipo: 'artefato', rotulo: 'artifactProductBrief' },
  'artifact.business_rule': { tipo: 'artefato', rotulo: 'artifactBusinessRule' },
  'artifact.module_map': { tipo: 'artefato', rotulo: 'artifactModuleMap' },
  'artifact.module_routing': { tipo: 'artefato', rotulo: 'artifactModuleRouting' },
  'artifact.insight': { tipo: 'artefato', rotulo: 'artifactInsight' },
  'delegation.completed': {
    tipo: 'delegacao',
    rotulo: 'delegationCompleted',
    detalhe: (p) => texto(p.area),
  },
  'delegation.failed': {
    tipo: 'delegacao',
    rotulo: 'delegationFailed',
    detalhe: (p, t) => comOrigem(t, texto(p.failureOrigin)),
  },
  'delegation.dispensed': { tipo: 'delegacao', rotulo: 'delegationDispensed' },
  // `dev.started` é emitido ao RECEBER a ordem de trabalhar, ANTES de
  // reivindicar task nenhuma (`DevAgentServer.handle_cast(:work)`, e só
  // depois `try_claim`) — "começou a task" afirmava o que ainda não tinha
  // acontecido. Quem diz que há task é `dev.working`, que carrega o título.
  'dev.started': { tipo: 'trabalho', rotulo: 'devStarted' },
  'dev.working': {
    tipo: 'trabalho',
    rotulo: 'devWorking',
    detalhe: (p) => texto(p.taskTitle),
  },
  'dev.idle': { tipo: 'trabalho', rotulo: 'devIdle' },
  'dev.awaiting_approval': { tipo: 'trabalho', rotulo: 'devAwaitingApproval' },
  'dev.awaiting_gate': { tipo: 'gate', rotulo: 'devAwaitingGate' },
  'dev.blocked': {
    tipo: 'trabalho',
    rotulo: 'devBlocked',
    detalhe: (p) => texto(p.reason),
  },
  // RN-502: sem container `running` REGISTRADO o dev agent não reivindica
  // task e fica `:idle`, re-tentando quando o container subir. O `reason`
  // vem do engine por extenso e diz o que fazer — é ele o detalhe.
  'dev.blocked_by_container': {
    tipo: 'espera',
    rotulo: 'devBlockedByContainer',
    detalhe: (p) => texto(p.reason),
  },
  'dev.error': {
    tipo: 'falha',
    rotulo: 'devError',
    detalhe: (p) => texto(p.reason),
  },
  'dev.idle_tripped': { tipo: 'trabalho', rotulo: 'devIdleTripped' },
  'pr.gate_changed': {
    tipo: 'gate',
    rotulo: 'prGateChanged',
    detalhe: (p) => texto(p.gate) ?? texto(p.status),
  },
};

/**
 * Tipo `dev.*` que o engine emite e que a árvore decidiu NÃO mostrar, com o
 * motivo — a mesma válvula de `DEV_STATUS_EVENTS_FORA` no painel. Vazio hoje:
 * os tipos que o engine emite têm todos um marco honesto. Declarar aqui é
 * decisão registrada, nunca esquecimento.
 */
export const TRADUCAO_FORA: Record<string, string> = {};

/** As chaves de rótulo que a tabela USA — o teste as cobra nos dois locales. */
export const CHAVES_DE_ROTULO_USADAS: readonly ChaveDeRotulo[] = Object.values(TRADUCAO).map(
  (t) => t.rotulo,
);

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
 *
 * Para marco `dev.*`, SE é trabalho em curso não se decide aqui: é o estado
 * que o PAINEL do time dá ao mesmo evento (`statusDoEventoDev`), e só
 * `trabalhando` deixa o ramo ativo. Duas tabelas para o mesmo evento
 * divergiram uma vez (AT-087) — a árvore dizia trabalho onde o painel dizia
 * `aguardando`. Tipo `dev.*` que o painel não decidiu NÃO vira ativo: na
 * dúvida a tela não afirma trabalho.
 */
function frasePresente(
  ultimo: Marco | undefined,
  tArvore: Tradutor,
): { agora: string; ativo: boolean } {
  if (!ultimo) return { agora: tArvore('now.notYet'), ativo: false };

  if (DESFECHOS.has(ultimo.tipo)) {
    if (ultimo.tipo === 'falha') {
      return {
        agora: ultimo.detalhe
          ? tArvore('now.failedWithDetail', { detalhe: ultimo.detalhe })
          : tArvore('now.failed'),
        ativo: false,
      };
    }
    if (ultimo.tipo === 'handoff') {
      return {
        agora: ultimo.detalhe
          ? tArvore('now.handedOffWithDetail', { detalhe: ultimo.detalhe })
          : tArvore('now.handedOff'),
        ativo: false,
      };
    }
    return { agora: tArvore('now.turnEnded'), ativo: false };
  }

  const ativo = ultimo.eventType.startsWith('dev.')
    ? statusDoEventoDev(ultimo.eventType) === 'trabalhando'
    : true;
  return {
    agora: ultimo.detalhe
      ? tArvore('now.withDetail', { rotulo: ultimo.rotulo, detalhe: ultimo.detalhe })
      : ultimo.rotulo,
    ativo,
  };
}

/**
 * `idioma` é entrada explícita (AT-134): rótulo e frase do presente saem
 * traduzidos daqui, e o componente que memoiza a árvore passa o idioma
 * corrente — trocar de idioma refaz a árvore. Omitido, vale o idioma ativo.
 */
export function montarArvore(
  events: SessionEvent[],
  idioma?: string,
): {
  ramos: RamoDeAgente[];
  tronco: Marco[];
} {
  const tArvore = tradutorDaArvore(idioma);
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
      rotulo: tArvore(`label.${traducao.rotulo}`),
      detalhe: traducao.detalhe?.(payload, tArvore),
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
      const { agora, ativo } = frasePresente(ordenados[ordenados.length - 1], tArvore);
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
