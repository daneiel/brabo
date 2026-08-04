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
      });
      continue;
    }

    if (!traducao) continue;
    // Só evento COM dono vira ramo: um marco de `system` não pertence a
    // agente nenhum, e pendurá-lo num deles seria inventar autoria.
    if (evento.actor.kind !== 'agent') continue;

    const agente = evento.actor.id;
    const marcos = porAgente.get(agente) ?? [];
    marcos.push({
      eventId: evento.id,
      seq: evento.seq,
      tipo: traducao.tipo,
      rotulo: traducao.rotulo,
      detalhe: traducao.detalhe?.(payload),
      em: evento.createdAt,
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
      };
    },
  );

  // Quem está ATIVO primeiro — a pergunta "quem está trabalhando agora" é a
  // que se faz olhando a tela; o histórico de quem parou pode esperar.
  ramos.sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return b.ultimoEm.localeCompare(a.ultimoEm);
  });

  return { ramos, tronco };
}
