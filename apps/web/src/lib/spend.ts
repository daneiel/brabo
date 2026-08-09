/**
 * O relatório de gasto, em duas audiências (FASE 22, ADR 0063, RN-101).
 *
 * Os tipos moram aqui e não em `api-types.ts` por dois motivos: são a forma de
 * uma LEITURA agregada e não de uma entidade do domínio, e o que é agregação
 * de tela envelhece junto com a tela.
 *
 * Nenhum dos dois tem campo `provider`, e é a ausência que importa. A pergunta
 * "de que CHAVE saiu" é a fatura do owner, e continua respondida só por
 * `CredentialSpend` — que exige `owner` na rota (RN-060).
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

/** A fatura do workspace — só o owner alcança. */
export interface WorkspaceSpendReport {
  workspaceId: string;
  ownerId: string;
  dias: number;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porModelo: SpendLinha[];
  porProjeto: SpendLinha[];
  porAtor: SpendLinha[];
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

/** `US$ 0,03 · 42 chamadas` — o texto que o título acessível da barra carrega. */
export function tituloDoDia(ponto: SpendPorDia, custo: string): string {
  return `${diaCurto(ponto.dia)} · ${custo} · ${ponto.chamadas} chamada${
    ponto.chamadas === 1 ? '' : 's'
  }`;
}

/** Rótulo de ator: agente aparece pelo slug, pessoa pelo id curto. */
export function rotuloDoAtor(linha: SpendLinha): string {
  if (linha.actorKind === 'agent') return linha.chave;
  return `${linha.chave.slice(0, 8)} (pessoa)`;
}

/** Tokens somados — o número que a tabela mostra ao lado do custo. */
export function tokensDe(linha: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return linha.inputTokens + linha.outputTokens;
}
