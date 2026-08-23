import type { TokenThreshold } from '../components/TokenMeter';
import i18n from './i18n';

/**
 * O relatório de gasto, em duas audiências (FASE 22, ADR 0063, RN-101).
 *
 * Os tipos moram aqui e não em `api-types.ts` por dois motivos: são a forma de
 * uma LEITURA agregada e não de uma entidade do domínio, e o que é agregação
 * de tela envelhece junto com a tela.
 *
 * `MySpend` não tem campo `provider`, e é a ausência que importa (RN-101). Em
 * `WorkspaceSpendReport` o eixo VOLTOU (ADR 0076/RN-186) — ver `porProvider`
 * abaixo. A pergunta "de que CHAVE saiu" continua sendo outra e respondida só
 * por `CredentialSpend`, que exige `owner` na rota (RN-060).
 */

export interface SpendLinha {
  chave: string;
  rotulo: string | null;
  actorKind: string | null;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
}

export interface SpendPorDia {
  /** `YYYY-MM-DD` em UTC. A série vem DENSA: dia sem gasto chega com zero. */
  dia: string;
  costMicros: number;
  chamadas: number;
}

/**
 * A fatura do workspace — só o owner alcança.
 *
 * `porProvider`/`porOwner`/`porAgente` (Onda 1, frente D0, ADR 0076/RN-186) são
 * a mesma resposta de `GET /workspaces/:id/spend-report` — a api sempre devolve
 * os seis blocos juntos, numa consulta só (RN-188). O apêndice temporário em
 * `api-client.ts`/`api-types.ts` (`getWorkspaceSpendReportComProvider`,
 * `WorkspaceSpendPorProvider`) existia para não editar este arquivo em cima de
 * outra frente da mesma onda; a integração é esta — os três campos migram para
 * cá, e `getWorkspaceSpendReport` (sem sufixo) já os tipa corretamente.
 */
export interface WorkspaceSpendReport {
  workspaceId: string;
  ownerId: string;
  dias: number;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porModelo: SpendLinha[];
  /** Por PROVIDER — fala de CREDENCIAL, e só existe na visão do owner (RN-186). */
  porProvider: SpendLinha[];
  porProjeto: SpendLinha[];
  porAtor: SpendLinha[];
  /** Partição de `porAtor` por `actorKind === 'user'` (RN-188). */
  porOwner: SpendLinha[];
  /** Partição de `porAtor` por `actorKind === 'agent'` (RN-188). */
  porAgente: SpendLinha[];
  porDia: SpendPorDia[];
}

/** O meu consumo — o que qualquer membro do projeto alcança, e só o dele. */
export interface MySpend {
  projectId: string;
  dias: number;
  actorId: string;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porSessao: SpendLinha[];
  porDia: SpendPorDia[];
}

/**
 * A altura de cada barra, em fração de 0 a 1.
 *
 * Escala pelo MAIOR valor da série, não por um teto fixo: a pergunta da
 * sparkline é sobre o RITMO ("em que dias saiu dinheiro"), e um eixo absoluto
 * achataria toda semana barata numa linha reta.
 *
 * Série toda zerada devolve zeros — e não `NaN`, que é o que a divisão direta
 * daria e o que o SVG renderiza como barra fantasma.
 */
export function alturasRelativas(valores: number[]): number[] {
  const maximo = Math.max(0, ...valores);
  if (maximo === 0) return valores.map(() => 0);
  return valores.map((v) => Math.max(0, v) / maximo);
}

/**
 * `2026-08-09` → `09/08`. Sem ano: o eixo é curto e a janela nunca cruza mais
 * de meio ano.
 *
 * Fatiar a string em vez de passar por `Date`: o bucket já vem truncado em UTC,
 * e `new Date('2026-08-09')` renderizado em America/Sao_Paulo volta um dia.
 */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split('-');
  return `${d}/${mes}`;
}

/**
 * `US$ 0,03 · 42 chamadas` — o texto que o título acessível da barra carrega.
 *
 * `i18n.t()` resolve DENTRO da função, não em constante de módulo, para
 * reagir ao idioma vigente a cada chamada (mesmo padrão de `session-kind.ts`)
 * — e `count` deixa o próprio i18next escolher `_one`/`_other`, em vez da
 * lógica manual de plural que havia aqui antes.
 */
export function tituloDoDia(ponto: SpendPorDia, custo: string): string {
  return i18n.t('libSpend.callTitle', {
    ns: 'spend',
    count: ponto.chamadas,
    dia: diaCurto(ponto.dia),
    custo,
  });
}

/** Rótulo de ator: agente aparece pelo slug, pessoa pelo id curto. */
export function rotuloDoAtor(linha: SpendLinha): string {
  if (linha.actorKind === 'agent') return linha.chave;
  return i18n.t('libSpend.actorPerson', {
    ns: 'spend',
    id: linha.chave.slice(0, 8),
  });
}

/** Tokens somados — o número que a tabela mostra ao lado do custo. */
export function tokensDe(linha: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return linha.inputTokens + linha.outputTokens;
}

// ---------------------------------------------------------------------------
// Gasto por PROVIDER na tela (PROGRAMA 28, Onda 3, frente D1 — RN-211).
// ---------------------------------------------------------------------------

/**
 * A quebra por provider vira `Ranking` — a MESMA peça de "Por modelo"/"Por
 * projeto"/"Por agente e pessoa" — e não uma barra empilhada colorida por
 * provider, e a razão é MEDIDA, não estética.
 *
 * O handoff pede segmentos coloridos por provider (diário e agregado). A
 * skill de dataviz deste repo manda VALIDAR paleta categórica por script antes
 * de usar, nunca por olho, e o script (`validate_palette.js`) reprovou toda
 * combinação de 3+ tokens de `design/tokens.css` testada contra os DOIS temas:
 * `--accent`+`--violet` é o único par que passa nos dois — a partir do
 * terceiro token (`--success`, `--warning`, `--danger`, `--syntax-function`,
 * `--syntax-comment`, `--syntax-operator`) sempre algum cai fora da faixa de
 * luminosidade, do piso de croma, ou fica indistinguível de um vizinho mesmo
 * para visão normal (ΔE < 15) — em pelo menos um dos dois temas. E mesmo se
 * passasse, ciclar uma paleta de 2 cores contra 9 providers (ADR 0043) é
 * exatamente o anti-padrão que a skill nomeia: "a 9th series is never a
 * generated hue — it folds into 'Other'". `--syntax-keyword`/`--syntax-string`/
 * `--syntax-type` não são uma saída: são o MESMO hex de `--accent`/`--warning`/
 * `--success` (ver `design/tokens.css`), então "oito tons de sintaxe" na
 * prática são só três com nome extra.
 *
 * Inventar um hex novo por provider resolveria a matemática e violaria a
 * instrução desta frente ("não invente hex novo"). A saída HONESTA é a mesma
 * das outras vezes que o produto encontrou um dado que não sustenta o desenho
 * pedido (RN-151, RN-210): não fabricar. `Ranking` já resolve "qual é maior e
 * quanto maior" sem precisar de identidade por cor — é rótulo + comprimento da
 * barra (sempre `--accent`), a mesma leitura que as outras três quebras desta
 * tela já usam. Ver `alturasRelativas`, reaproveitado por igual.
 *
 * A série DIÁRIA por provider (a outra metade do pedido do handoff) tem uma
 * segunda barreira, anterior a esta: `sumGroupedBy` (ADR 0076) agrupa por UMA
 * dimensão por vez — `day` OU `provider`, nunca as duas — e não existe
 * agregação cruzada no backend desta onda (frente D0 não a construiu; D1 só
 * consome o que existe). Aproximar via proporção do período aplicada a cada
 * dia seria inventar um número com cara de dado medido, a mesma classe de erro
 * que a RN-151 fechou para o badge da sidebar.
 */

// ---------------------------------------------------------------------------
// Bloco "por projeto" e alertas de custo (RN-212/RN-213) — leitura pura do
// orçamento que `budgets.controller.ts`/`budget-threshold.ts` já calculam.
// Nenhuma regra de negócio nova: `lastThresholdNotified` já É o veredito de
// "cruzou 70/90/100", persistido no MOMENTO da chamada que cruzou — refazer a
// conta aqui com `spentMicros/limitMicros` reproduziria `crossedThresholds`
// (`apps/api/src/domain/llm/budget-threshold.ts`) de um jeito que diverge dele
// na primeira mudança de um lado só.
// ---------------------------------------------------------------------------

export interface BudgetParaAlerta {
  limitMicros: number;
  spentMicros: number;
  policy: 'block' | 'allow';
  lastThresholdNotified: number;
}

export interface AlertaDeOrcamento {
  nivel: Extract<TokenThreshold, 'warning' | 'danger'>;
  mensagem: string;
}

/**
 * O alerta de custo do projeto, se houver — `null` abaixo de 70% ou sem teto
 * definido (`limitMicros <= 0`, o mesmo piso de `crossedThresholds`).
 *
 * `lastThresholdNotified` só sobe quando uma chamada REAL cruzou o degrau
 * (`record-llm-usage.use-case.ts`), então o alerta nunca aparece um passo à
 * frente do que de fato aconteceu.
 */
export function alertaDeOrcamento(
  budget: BudgetParaAlerta,
): AlertaDeOrcamento | null {
  if (budget.limitMicros <= 0) return null;
  if (budget.lastThresholdNotified < 70) return null;

  const nivel = budget.lastThresholdNotified >= 90 ? 'danger' : 'warning';
  const bloqueado =
    budget.policy === 'block' && budget.spentMicros >= budget.limitMicros;

  const mensagem = bloqueado
    ? i18n.t('libSpend.budgetBlocked', {
        ns: 'spend',
        pct: budget.lastThresholdNotified,
      })
    : i18n.t('libSpend.budgetWarning', {
        ns: 'spend',
        pct: budget.lastThresholdNotified,
      });

  return { nivel, mensagem };
}
