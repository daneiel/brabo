import type { SessionEvent } from './api-types';
import i18n from './i18n';

/**
 * O MOTIVO da decisão de política e a RAIZ do escopo, lidos do evento
 * `proposed_action.created` — a fonte ÚNICA da frase que a tela mostra sobre
 * eles (AT-148, RN-614).
 *
 * O evento carrega `reason` desde a RN-567 (a string de `decide()`, nos três
 * desfechos) e, só em ação `terminal`, `scopeRoot = { executionMode, ancora,
 * segmento }` desde a RN-609. Dois lugares mostram isso — a linha do evento
 * no painel de log (`classifyEvent`) e o `ApprovalCard` das telas de decisão —
 * e os dois chamam {@link fraseDaDecisaoDaPolitica}. Nunca dois textos: duas
 * redações do mesmo fato divergem na primeira mudança de payload.
 *
 * Três regras que valem registro:
 *
 * - **Ausente não é "sem motivo".** Evento gravado antes da RN-567 não tem
 *   `reason`, e antes da RN-609 não tem `scopeRoot`. A frase diz "não
 *   registrado" — nunca cala, nunca inventa. E `scopeRoot` ausente numa ação
 *   que NÃO é `terminal` é o normal (o escopo só é consultado ali), então
 *   nesse caso a frase simplesmente não fala de raiz.
 * - **Nunca caminho absoluto.** O evento não tem, e esta função não o
 *   reconstrói: mostra o SEGMENTO relativo e diz contra qual âncora ele vale.
 *   `indisponivel` tem texto próprio — é justamente o caso em que cair no
 *   absoluto seria o vazamento que a RN-609 recusa.
 * - **As frases resolvem via `i18n.t()` DENTRO da função**, o mesmo padrão de
 *   `session-falha.ts`, para reagir ao idioma vigente em cada chamada.
 */

const NS = 'approvals';

/** As âncoras que a RN-609 define. Outra qualquer é tratada como desconhecida. */
export type AncoraDoEscopo = 'raiz_gerenciada' | 'base_de_projetos' | 'indisponivel' | 'nome_da_pasta';

const ANCORAS_CONHECIDAS: ReadonlySet<string> = new Set<AncoraDoEscopo>([
  'raiz_gerenciada',
  'base_de_projetos',
  'indisponivel',
  'nome_da_pasta',
]);

export interface RaizDoEscopoLida {
  /** `null` quando a âncora gravada não é uma das quatro conhecidas. */
  ancora: AncoraDoEscopo | null;
  segmento: string | null;
}

export interface DecisaoDaPoliticaLida {
  /** O `reason` de `decide()`; `null` = NÃO REGISTRADO (evento anterior). */
  motivo: string | null;
  /** `scopeRoot`; `null` = ausente no evento. */
  raiz: RaizDoEscopoLida | null;
  /** O `actionType` do evento, quando veio — é ele que diz se a raiz faltou. */
  actionType: string | null;
  /** O `status` do evento, quando veio. */
  status: string | null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** Lê o payload de um `proposed_action.created` tolerando QUALQUER forma. */
export function lerDecisaoDaPolitica(payload: unknown): DecisaoDaPoliticaLida {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const bruta = p.scopeRoot;
  let raiz: RaizDoEscopoLida | null = null;
  if (bruta && typeof bruta === 'object') {
    const r = bruta as Record<string, unknown>;
    const ancora = typeof r.ancora === 'string' && ANCORAS_CONHECIDAS.has(r.ancora)
      ? (r.ancora as AncoraDoEscopo)
      : null;
    raiz = { ancora, segmento: texto(r.segmento) };
  }
  return {
    motivo: texto(p.reason),
    raiz,
    actionType: texto(p.actionType),
    status: texto(p.status),
  };
}

/** A metade da frase que fala da raiz; `null` quando não há o que dizer. */
function fraseDaRaiz(decisao: DecisaoDaPoliticaLida): string | null {
  const { raiz } = decisao;
  if (!raiz) {
    // Só `terminal` consulta o escopo (RN-609): ausente em outro tipo é o
    // normal e não merece frase; ausente em `terminal` é evento anterior.
    return decisao.actionType === 'terminal'
      ? i18n.t('politica.raiz.naoRegistrada', { ns: NS })
      : null;
  }
  // `indisponivel` tem texto próprio, sem segmento — por definição não há um.
  if (raiz.ancora === 'indisponivel') return i18n.t('politica.raiz.indisponivel', { ns: NS });
  if (raiz.ancora === null || raiz.segmento === null) {
    return i18n.t('politica.raiz.formaDesconhecida', { ns: NS });
  }
  const chave = {
    raiz_gerenciada: 'politica.raiz.raizGerenciada',
    base_de_projetos: 'politica.raiz.baseDeProjetos',
    nome_da_pasta: 'politica.raiz.nomeDaPasta',
  }[raiz.ancora];
  return i18n.t(chave, { ns: NS, segmento: raiz.segmento });
}

/**
 * A frase do motivo e, quando houver, da raiz — a MESMA nos dois lugares que
 * a mostram (linha do log e `ApprovalCard`).
 */
export function fraseDaDecisaoDaPolitica(decisao: DecisaoDaPoliticaLida): string {
  const motivo = decisao.motivo
    ? i18n.t('politica.motivo', { ns: NS, motivo: decisao.motivo })
    : i18n.t('politica.motivoNaoRegistrado', { ns: NS });
  const raiz = fraseDaRaiz(decisao);
  return raiz ? `${motivo} · ${raiz}` : motivo;
}

/**
 * O `proposed_action.created` de uma ação, dentro dos eventos que a tela JÁ
 * carregou. `null` quando ele não está ali (fora da janela, ou outra sessão):
 * o `ApprovalCard` diz isso em texto, em vez de fingir que não há motivo.
 */
export function decisaoDaPoliticaDaAcao(
  actionId: string,
  eventos: readonly SessionEvent[],
): DecisaoDaPoliticaLida | null {
  const evento = eventos.find(
    (e) =>
      e.type === 'proposed_action.created' &&
      (e.payload as { actionId?: unknown } | null)?.actionId === actionId,
  );
  return evento ? lerDecisaoDaPolitica(evento.payload) : null;
}

/** O que o card mostra quando a tela lê o log mas o evento não está na janela. */
export function fraseDaDecisaoForaDoRecorte(): string {
  return i18n.t('politica.foraDoRecorte', { ns: NS });
}

/**
 * A linha do `proposed_action.created` no painel de log: o desfecho da
 * política e, depois do travessão, a MESMA frase do card.
 */
export function linhaDoEventoDePolitica(ator: string, payload: unknown): string {
  const decisao = lerDecisaoDaPolitica(payload);
  const chave =
    decisao.status === 'auto_approved'
      ? 'politica.linha.autoAprovada'
      : decisao.status === 'denied'
        ? 'politica.linha.negada'
        : decisao.status === 'pending'
          ? 'politica.linha.pendente'
          : 'politica.linha.proposta';
  return `${i18n.t(chave, { ns: NS, ator })} — ${fraseDaDecisaoDaPolitica(decisao)}`;
}
