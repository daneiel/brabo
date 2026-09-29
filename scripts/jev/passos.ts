/**
 * Do event log aos PASSOS que o Jev teria decidido (AT-237).
 *
 * Um PASSO é uma chamada ao modelo de chat, e é nela que o roteador da AT-235
 * seria consultado — uma vez por passo, antes do `provider.chat`. O event log
 * não marca passo (`tool.call` não carrega fronteira, AT-235 lacuna 1), então a
 * fronteira vem de `token_usage`: uma linha por chamada de LLM, gravada pela api
 * ANTES de o engine gravar os `tool.call` que a resposta trouxe. Os `tool.call`
 * do mesmo ator e sessão entre duas linhas consecutivas são o MESMO passo.
 *
 * Três rótulos saem daí:
 *   - passo com UMA ferramenta (uma ou mais chamadas dela): rótulo = ela;
 *   - passo HETEROGÊNEO (duas ferramentas diferentes): o cardápio de UMA só
 *     cortaria o passo — contado à parte, acerto = escolha ∈ conjunto;
 *   - passo SEM `tool.call` depois da linha de uso: o modelo respondeu em texto
 *     (ou falhou) — é o único rótulo possível de `responder_sem_ferramenta`.
 *
 * Instantes (`em`) chegam no formato FIXO `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC,
 * seis casas — ver a consulta em `replay.ts`), e por isso se comparam como
 * TEXTO: `Date.parse` cortaria os microssegundos, e a linha de uso e o
 * `tool.call` do mesmo passo às vezes caem no mesmo milissegundo.
 *
 * Tudo aqui é função PURA: sem banco, sem rede. `replay.ts` é quem lê e chama.
 */

export const RESPONDER_SEM_FERRAMENTA = 'responder_sem_ferramenta';

/** Números de partida da AT-235 ("N = 6, cada texto cortado em 500"). */
export const PASSOS_RECENTES = 6;
export const CORTE_DO_PASSO = 500;
export const CORTE_DO_PEDIDO = 1500;
export const CORTE_DO_CONTEXTO = 1500;

export interface Evento {
  sessao: string;
  seq: number;
  tipo: string;
  atorTipo: string;
  ator: string;
  em: string;
  projetoId: string;
  payload: Record<string, unknown>;
}

export interface LinhaDeUso {
  sessao: string;
  ator: string;
  em: string;
}

export interface Catalogo {
  agentes: Record<string, string[]>;
  ferramentas: Record<string, string>;
  identidades: Record<string, string>;
}

export interface Chamada {
  seq: number;
  em: string;
  ferramenta: string;
  argumentos: unknown;
  /** Texto do `tool.result` pareado; `null` quando nenhum foi gravado. */
  resultado: string | null;
  ok: boolean | null;
}

export type Suspeita = 'sem_resultado' | 'ok_false' | 'falhou';

export interface Passo {
  id: string;
  sessao: string;
  projetoId: string;
  ator: string;
  /** Instante da linha de `token_usage` que abre o passo. */
  em: string;
  chamadas: Chamada[];
  /** Ferramentas distintas chamadas no passo, em ordem; `[]` = sem ferramenta. */
  rotulos: string[];
  /** Por que o rótulo pode estar errado (o modelo chamou e a ferramenta falhou). */
  suspeitas: Suspeita[];
}

/** O catálogo de um ator; `undefined` = fora da medição. */
export function catalogoDoAtor(c: Catalogo, ator: string): string[] | undefined {
  const proprio = c.agentes[ator];
  if (proprio) return proprio;
  if (ator.startsWith('dev-') && ator !== 'dev-lead') return c.agentes['dev-*'];
  return undefined;
}

/** A identidade do agente: a do mapa, senão o fallback de `Engine.Harness.Agents.identity/1`. */
export function identidadeDoAtor(c: Catalogo, ator: string): string {
  return c.identidades[ator] ?? `Você é o agente ${ator}.`;
}

export function textoDoResultado(payload: Record<string, unknown>): string {
  // Conversacionais gravam `resultado` (RN-589); o ToolLoop grava `result`.
  const r = payload.resultado ?? payload.result;
  if (typeof r === 'string') return r;
  if (r !== undefined) return JSON.stringify(r);
  const { ok: _ok, tool: _tool, ...resto } = payload;
  return JSON.stringify(resto);
}

export function suspeitasDe(chamadas: readonly Chamada[]): Suspeita[] {
  const s = new Set<Suspeita>();
  for (const c of chamadas) {
    if (c.resultado === null) s.add('sem_resultado');
    else if (c.ok === false) s.add('ok_false');
    else if (/^\s*(falhou|erro)\b/i.test(c.resultado) || /^exit [1-9]/.test(c.resultado)) s.add('falhou');
  }
  return [...s];
}

/**
 * Pareia cada `tool.call` com o `tool.result` do MESMO ator e ferramenta. O par
 * é o `tool.call` mais RECENTE ainda sem resultado (LIFO): a chamada que nunca
 * ganhou resultado não rouba o da seguinte, que é o defeito de parear em fila.
 */
export function parearChamadas(eventos: readonly Evento[]): Map<string, Chamada[]> {
  const porAtor = new Map<string, Chamada[]>();
  const abertas = new Map<string, Chamada[]>();
  const ordenados = [...eventos].sort((a, b) => (a.sessao === b.sessao ? a.seq - b.seq : a.sessao < b.sessao ? -1 : 1));
  for (const e of ordenados) {
    if (e.tipo !== 'tool.call' && e.tipo !== 'tool.result') continue;
    const ferramenta = typeof e.payload.tool === 'string' ? e.payload.tool : '';
    const chaveAtor = `${e.sessao}|${e.ator}`;
    const chaveAberta = `${chaveAtor}|${ferramenta}`;
    if (e.tipo === 'tool.call') {
      const c: Chamada = { seq: e.seq, em: e.em, ferramenta, argumentos: e.payload.args ?? null, resultado: null, ok: null };
      porAtor.set(chaveAtor, [...(porAtor.get(chaveAtor) ?? []), c]);
      abertas.set(chaveAberta, [...(abertas.get(chaveAberta) ?? []), c]);
    } else {
      const pilha = abertas.get(chaveAberta);
      const c = pilha?.pop();
      if (!c) continue;
      c.resultado = textoDoResultado(e.payload);
      c.ok = typeof e.payload.ok === 'boolean' ? e.payload.ok : null;
    }
  }
  return porAtor;
}

/**
 * Monta os passos: cada linha de uso abre um passo, e os `tool.call` do mesmo
 * (sessão, ator) com instante em (esta linha, próxima linha] entram nele.
 * Chamada antes da primeira linha de uso não tem fronteira e é descartada —
 * devolvida em `semFronteira` para o relatório dizer quantas.
 */
export function montarPassos(
  eventos: readonly Evento[],
  usos: readonly LinhaDeUso[],
  catalogo: Catalogo,
): { passos: Passo[]; semFronteira: number; foraDoCatalogo: number } {
  const chamadas = parearChamadas(eventos);
  const projetoDaSessao = new Map(eventos.map((e) => [e.sessao, e.projetoId]));
  const usosPorAtor = new Map<string, LinhaDeUso[]>();
  for (const u of usos) {
    if (!catalogoDoAtor(catalogo, u.ator)) continue;
    const k = `${u.sessao}|${u.ator}`;
    usosPorAtor.set(k, [...(usosPorAtor.get(k) ?? []), u]);
  }
  const passos: Passo[] = [];
  let semFronteira = 0;
  let foraDoCatalogo = 0;
  for (const [k, lista] of usosPorAtor) {
    lista.sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));
    const [sessao, ator] = k.split('|') as [string, string];
    const cat = catalogoDoAtor(catalogo, ator)!;
    const doAtor = chamadas.get(k) ?? [];
    semFronteira += doAtor.filter((c) => c.em <= lista[0]!.em).length;
    lista.forEach((u, i) => {
      const fim = lista[i + 1]?.em;
      const dentro = doAtor.filter((c) => c.em > u.em && (fim === undefined || c.em <= fim));
      foraDoCatalogo += dentro.filter((c) => !cat.includes(c.ferramenta)).length;
      const rotulos = [...new Set(dentro.map((c) => c.ferramenta))];
      passos.push({
        id: `${sessao}:${ator}:${i}`,
        sessao,
        projetoId: projetoDaSessao.get(sessao) ?? '',
        ator,
        em: u.em,
        chamadas: dentro,
        rotulos,
        suspeitas: suspeitasDe(dentro),
      });
    });
  }
  passos.sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));
  return { passos, semFronteira, foraDoCatalogo };
}

export function cortar(texto: string, teto: number): string {
  return texto.length <= teto ? texto : `${texto.slice(0, teto)}…[+${texto.length - teto}]`;
}

const AGENTES_DE_TAREFA = /^(dev-|qa-automacao$|qa-performance-seguranca$)/;

/**
 * O "pedido" do passo. Conversacional: a última `chat.message` escrita pelo
 * USUÁRIO na sessão antes do passo (é a última `role: user` que ele vê).
 * ToolLoop (dev, gates, Anamnese): a mensagem inicial do laço é montada em
 * código e NÃO vai ao event log; o que existe é o título da tarefa
 * (`dev.working`), usado para os dev agents e os gates que julgam uma tarefa.
 */
export function pedidoDoPasso(eventos: readonly Evento[], p: Passo): string {
  const antes = eventos.filter((e) => e.sessao === p.sessao && e.em <= p.em);
  if (AGENTES_DE_TAREFA.test(p.ator)) {
    const trabalhando = antes.filter(
      (e) => e.tipo === 'dev.working' && (p.ator.startsWith('dev-') ? e.payload.agentId === p.ator : true),
    );
    const t = trabalhando.at(-1);
    if (t && typeof t.payload.taskTitle === 'string') return `Tarefa: ${t.payload.taskTitle}`;
    return '(mensagem inicial do laço não gravada no event log)';
  }
  const doUsuario = antes.filter((e) => e.tipo === 'chat.message' && e.atorTipo === 'user');
  const m = doUsuario.at(-1);
  if (m && typeof m.payload.text === 'string') return cortar(m.payload.text, CORTE_DO_PEDIDO);
  return '(sem mensagem do usuário antes deste passo: kickoff)';
}

export interface EstadoDoJev {
  agente: string;
  pedido: string;
  contexto: string;
  passos_recentes: { ferramenta: string; argumentos: string; resultado: string }[];
}

/** O `state` da AT-235, recortado do que existia ANTES do passo. */
export function montarEstado(
  eventos: readonly Evento[],
  passos: readonly Passo[],
  p: Passo,
  catalogo: Catalogo,
  instrucoes: ReadonlyMap<string, string>,
): EstadoDoJev {
  const anteriores = passos
    .filter((q) => q.sessao === p.sessao && q.ator === p.ator && q.em < p.em)
    .flatMap((q) => q.chamadas)
    .slice(-PASSOS_RECENTES);
  const instrucao = instrucoes.get(`${p.projetoId}|${p.ator}`);
  const contexto = [identidadeDoAtor(catalogo, p.ator), instrucao].filter(Boolean).join('\n\n');
  return {
    agente: p.ator,
    pedido: pedidoDoPasso(eventos, p),
    contexto: cortar(contexto, CORTE_DO_CONTEXTO),
    passos_recentes: anteriores.map((c) => ({
      ferramenta: c.ferramenta,
      argumentos: cortar(JSON.stringify(c.argumentos), CORTE_DO_PASSO),
      resultado: c.resultado === null ? '(sem resultado gravado)' : cortar(c.resultado, CORTE_DO_PASSO),
    })),
  };
}
