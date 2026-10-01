/**
 * O laço de um dev agent, para o teste ao vivo da AT-239 — o que o engine faz
 * em `Engine.Harness.ToolLoop` e na fachada `EngineApiClient.llm_turn/5`, e o
 * que a api faz em `DecidirFerramentaDoPassoUseCase`, numa função só, com a
 * rede e as ferramentas INJETADAS (o `laco.spec.ts` roda tudo sem rede).
 *
 * O que vem do produto e o que é porta:
 *
 * - **A política do roteador é a do produto**, importada (`roteador.ts`):
 *   `recortarEstado`, `montarPedidoAoJev`, `menuP3`, `temColisaoDeNome` e o teto
 *   do `state`. As condições de consulta do caso de uso (`preparar/1`) são
 *   portadas: provider `openrouter` é dado (este teste só fala com ele), duas
 *   ou mais ferramentas, agente fora de `AGENTES_FORA_DO_ROTEAMENTO`.
 * - **O laço é porta**: teto de iterações (`Engine.Harness.Iteracoes`, 60 para
 *   dev — aqui configurável), recuperação de chamada em texto contra o REGISTRO
 *   inteiro (`recuperacao.ts`), parada em `report_done`/`report_blocked` com
 *   resultado ok (`Engine.Dev.Hooks`), e a volta com o catálogo inteiro quando o
 *   menu restrito fez o modelo responder sem ferramenta
 *   (`RoteamentoDeFerramenta.repetir_com_catalogo_inteiro?/2`).
 * - **Fora, declarado**: compactação de contexto (`ContextManager`), hooks de
 *   aprovação, a orientação de idioma e o perfil do autor (mensagens de
 *   sistema no fim — iguais nos dois braços), e o teto de orçamento local.
 */
import type { ResultadoDaFerramenta } from './executor.ts';
import { recuperar } from './recuperacao.ts';
import {
  AGENTES_FORA_DO_ROTEAMENTO,
  ORIGEM_DA_QUEDA,
  TETO_DO_ESTADO_EM_TOKENS,
  menuP3,
  montarPedidoAoJev,
  recortarEstado,
  temColisaoDeNome,
  type MotivoDaQueda,
  type OrigemDaQueda,
  type PedidoAoJev,
} from './roteador.ts';

export interface ChamadaDeFerramenta {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** O `ChatMessage` de `@brabo/shared`, na forma que o engine manda à api. */
export interface MensagemDoLaco {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ChamadaDeFerramenta[];
  toolCallId?: string;
  name?: string;
}

export interface Definicao {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RespostaDoChat {
  content: string;
  toolCalls: ChamadaDeFerramenta[];
  /** `usage.cost` da resposta, USD; `null` se não veio. */
  custoUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  latenciaMs: number;
  /** Falha do provider (a api devolve 200 com `error` no corpo, e o engine segue). */
  erro: string | null;
  /** A chamada nem chegou a responder (transporte): na volta com o catálogo inteiro, mantém-se a primeira. */
  transporte?: boolean;
}

/** A forma de `ResultadoDoRoteador` (`apps/api/src/application/ports/tool-router.port.ts`). */
export type ResultadoDoJev =
  | {
      status: 'decidido';
      escolha: string;
      confianca: number;
      probabilidades: Record<string, number>;
      custoUsd: number | null;
      latenciaMs: number;
    }
  | {
      status: 'queda';
      motivo: MotivoDaQueda;
      detalhe: string;
      custoUsd: number | null;
      latenciaMs: number;
    };

export type Braco = 'ligado' | 'desligado';

export interface Dependencias {
  chat(mensagens: readonly MensagemDoLaco[], ferramentas: readonly Definicao[]): Promise<RespostaDoChat>;
  jev(pedido: PedidoAoJev, opcoes: readonly string[]): Promise<ResultadoDoJev>;
  executar(nome: string, args: Record<string, unknown>, historico: readonly MensagemDoLaco[]): ResultadoDaFerramenta;
  /** Interrompe ANTES de uma chamada paga quando o gasto chegou ao teto. */
  podeGastar(): boolean;
  agora(): number;
}

export interface RoteamentoDoPasso {
  aplicado: boolean;
  menuDepois: string[];
  escolha: string | null;
  confianca: number | null;
  anterior: string | null;
  motivoDaQueda: MotivoDaQueda | null;
  origemDaQueda: OrigemDaQueda | null;
  latenciaMs: number;
  custoUsd: number;
  /** Chamadas a ferramenta que não estavam no cardápio do passo (`foraDoCardapio`). */
  foraDoCardapio: string[];
  /** O menu restrito fez o modelo responder sem ferramenta, e o passo voltou com o catálogo inteiro. */
  repetidoComCatalogoInteiro: boolean;
}

export interface Passo {
  iteracao: number;
  /** Do início do passo (antes do Jev) ao fim da(s) chamada(s) de chat. */
  latenciaMs: number;
  latenciaDoChatMs: number;
  custoDoChatUsd: number;
  chamadasDeChat: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  ferramentas: string[];
  /** As chamadas vieram em TEXTO e passaram por `ToolCallRecovery`. */
  recuperado: boolean;
  erro: string | null;
  roteamento: RoteamentoDoPasso | null;
}

export type Fim = 'report_done' | 'report_blocked' | 'sem_chamada' | 'limite' | 'erro' | 'teto_de_gasto';

export interface Execucao {
  fim: Fim;
  passos: Passo[];
  /** Relógio de parede da execução inteira: Jev + chat + ferramentas. */
  latenciaMs: number;
  mensagens: number;
}

const tokensAproximados = (texto: string): number => Math.ceil(texto.length / 4);

/**
 * `DecidirFerramentaDoPassoUseCase.preparar/1` + `executar/2`, menos o que é do
 * banco (a flag do workspace — aqui é o braço — e a linha de `token_usage`).
 * `null` = não roteia (as mesmas condições, nenhuma gera registro).
 */
export async function rotear(
  agente: string,
  mensagens: readonly MensagemDoLaco[],
  catalogo: readonly Definicao[],
  jev: Dependencias['jev'],
): Promise<{ ferramentas: readonly Definicao[]; roteamento: Omit<RoteamentoDoPasso, 'foraDoCardapio' | 'repetidoComCatalogoInteiro'> } | null> {
  if (catalogo.length < 2 || AGENTES_FORA_DO_ROTEAMENTO.has(agente)) return null;
  const nomes = catalogo.map((t) => t.name);
  const queda = (motivo: MotivoDaQueda, anterior: string | null, latenciaMs = 0, custoUsd = 0) => ({
    ferramentas: catalogo,
    roteamento: {
      aplicado: false,
      menuDepois: nomes,
      escolha: null,
      confianca: null,
      anterior,
      motivoDaQueda: motivo,
      origemDaQueda: ORIGEM_DA_QUEDA[motivo],
      latenciaMs,
      custoUsd,
    },
  });
  if (temColisaoDeNome(catalogo)) return queda('colisao_de_nome', null);
  const { estado, anterior } = recortarEstado(agente, mensagens as never);
  const pedido = montarPedidoAoJev(estado, catalogo);
  const json = JSON.stringify(pedido);
  // O produto conta com o `TokenEstimator` da api; aqui, caracteres ÷ 4 (a
  // mesma aproximação de todo o replay). O pedido de um dev agent fica em
  // ~2 mil tokens, longe dos 8 mil: a diferença não decide nada aqui.
  if (json.length > TETO_DO_ESTADO_EM_TOKENS * 8 || tokensAproximados(json) > TETO_DO_ESTADO_EM_TOKENS) {
    return queda('estado_grande', anterior);
  }
  const r = await jev(pedido, nomes);
  const custo = r.custoUsd ?? 0;
  if (r.status === 'queda') return queda(r.motivo, anterior, r.latenciaMs, custo);
  const menu = menuP3(nomes, r.escolha, anterior);
  const efetivas = catalogo.filter((t) => menu.includes(t.name));
  return {
    ferramentas: efetivas,
    roteamento: {
      aplicado: efetivas.length < catalogo.length,
      menuDepois: efetivas.map((t) => t.name),
      escolha: r.escolha,
      confianca: r.confianca,
      anterior,
      motivoDaQueda: null,
      origemDaQueda: null,
      latenciaMs: r.latenciaMs,
      custoUsd: custo,
    },
  };
}

export interface ParametrosDaExecucao {
  agente: string;
  sistema: string;
  pedido: string;
  catalogo: readonly Definicao[];
  braco: Braco;
  maxIteracoes: number;
}

export async function executarLaco(p: ParametrosDaExecucao, d: Dependencias): Promise<Execucao> {
  const t0 = d.agora();
  const nomes = p.catalogo.map((t) => t.name);
  const mensagens: MensagemDoLaco[] = [
    { role: 'system', content: p.sistema },
    { role: 'user', content: p.pedido },
  ];
  const passos: Passo[] = [];
  const fim = (f: Fim): Execucao => ({ fim: f, passos, latenciaMs: d.agora() - t0, mensagens: mensagens.length });

  for (let iteracao = 0; ; iteracao++) {
    if (iteracao >= p.maxIteracoes) return fim('limite');
    if (!d.podeGastar()) return fim('teto_de_gasto');

    const inicio = d.agora();
    const decisao = p.braco === 'ligado' ? await rotear(p.agente, mensagens, p.catalogo, d.jev) : null;
    let resposta = await d.chat(mensagens, decisao?.ferramentas ?? p.catalogo);
    let latenciaDoChat = resposta.latenciaMs;
    let custoDoChat = resposta.custoUsd ?? 0;
    let promptTokens = resposta.promptTokens ?? 0;
    let completionTokens = resposta.completionTokens ?? 0;
    let cachedTokens = resposta.cachedTokens ?? 0;
    let chamadasDeChat = 1;
    let repetiu = false;

    const semNada = (r: RespostaDoChat) => r.toolCalls.length === 0 && recuperar(r.content, nomes).length === 0;
    if (decisao?.roteamento.aplicado && !resposta.erro && semNada(resposta) && d.podeGastar()) {
      const segunda = await d.chat(mensagens, p.catalogo);
      chamadasDeChat = 2;
      latenciaDoChat += segunda.latenciaMs;
      custoDoChat += segunda.custoUsd ?? 0;
      promptTokens += segunda.promptTokens ?? 0;
      completionTokens += segunda.completionTokens ?? 0;
      cachedTokens += segunda.cachedTokens ?? 0;
      if (!segunda.transporte) {
        resposta = segunda;
        repetiu = true;
      }
    }

    const nativas = resposta.toolCalls;
    const chamadas = nativas.length > 0 ? nativas : recuperar(resposta.content, nomes);
    const menu = decisao?.roteamento.menuDepois ?? nomes;
    passos.push({
      iteracao,
      latenciaMs: d.agora() - inicio,
      latenciaDoChatMs: latenciaDoChat,
      custoDoChatUsd: custoDoChat,
      chamadasDeChat,
      promptTokens,
      completionTokens,
      cachedTokens,
      ferramentas: chamadas.map((c) => c.name),
      recuperado: nativas.length === 0 && chamadas.length > 0,
      erro: resposta.erro,
      roteamento: decisao
        ? {
            ...decisao.roteamento,
            // Na repetição o cardápio efetivo foi o catálogo inteiro; o engine
            // mede `foraDoCardapio` contra o menu RESTRITO da primeira volta.
            foraDoCardapio: [...new Set(nativas.map((c) => c.name).filter((n) => !menu.includes(n)))],
            repetidoComCatalogoInteiro: repetiu,
          }
        : null,
    });

    mensagens.push(nativas.length > 0 ? { role: 'assistant', content: resposta.content, toolCalls: nativas } : { role: 'assistant', content: resposta.content });

    if (resposta.erro && chamadas.length === 0) return fim('erro');
    if (chamadas.length === 0) return fim('sem_chamada');

    for (const c of chamadas) {
      const r = d.executar(c.name, c.arguments, mensagens);
      mensagens.push({ role: 'tool', content: r.conteudo, toolCallId: c.id ?? undefined, name: c.name });
      if (r.ok && (c.name === 'report_done' || c.name === 'report_blocked')) return fim(c.name);
    }
  }
}
