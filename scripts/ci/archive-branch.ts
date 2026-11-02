/**
 * archive-branch — decide se uma branch mergeada deve ser arquivada, e o
 * ref de destino. Fonte da política: docs/explanation/branching-policy.md
 *
 * "Arquivar" aqui é mecânico, não é o merge em si: mover a branch de
 * `refs/heads/<nome>` para `refs/archive/<nome>` — fora do namespace de
 * branches (some da lista do GitHub), mas o objeto e o histórico continuam
 * no repositório, recuperável por quem souber o ref. As três permanentes
 * (dev/qa/main) NUNCA são arquivadas — elas aparecem como `head` de todo PR
 * de promoção mergeado (dev→qa, qa→main), e são exatamente o caso que este
 * módulo existe para excluir. `gh-pages` também fica de fora: é a branch de
 * deploy do site de docs (GitHub Pages), não uma branch de feature — apagar
 * `refs/heads/gh-pages` derrubaria o site.
 *
 * PR de fork (branch head vive em OUTRO repositório) também não é arquivado:
 * o `GITHUB_TOKEN` deste repositório não tem — e não deveria ter — permissão
 * para mexer em refs de um repositório de terceiros.
 *
 * Desde a AT-557 a branch só é arquivada DIAS_ATE_ARQUIVAR dias depois do
 * merge, por checagem diária (`aptaParaArquivar` + o adaptador CLI).
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

const NUNCA_ARQUIVAR = new Set(['dev', 'qa', 'main', 'gh-pages']);

/**
 * @param branch - nome da branch (head do PR mergeado)
 * @param headRepo - `owner/repo` de onde a branch head vem
 * @param baseRepo - `owner/repo` do repositório onde o PR foi aberto
 */
export function deveArquivar(branch: string, headRepo: string, baseRepo: string): boolean {
  if (branch.length === 0) return false;
  if (NUNCA_ARQUIVAR.has(branch)) return false;
  if (headRepo !== baseRepo) return false;
  return true;
}

/** `feature/foo` → `refs/archive/feature/foo`. */
export function refDeArquivo(branch: string): string {
  return `refs/archive/${branch}`;
}

/** Dias depois do merge até a branch ser arquivada (decisão do dono, 15/10, AT-557). */
export const DIAS_ATE_ARQUIVAR = 7;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface EntradaDeAptidao {
  branch: string;
  headRepo: string;
  baseRepo: string;
  /** Há PR ABERTA cuja head é esta branch. */
  prAberta: boolean;
  /** A PR mergeada mais recente com esta head, no mesmo repositório. */
  ultimaMergeada: { mergedAt: string; headSha: string } | null;
  /** SHA atual de `refs/heads/<branch>`. */
  shaAtual: string;
  agora: Date;
}

/**
 * Apta = fora das exceções de `deveArquivar`, sem PR aberta, mergeada há
 * DIAS_ATE_ARQUIVAR dias ou mais e sem commit depois do merge. Branch sem PR
 * mergeada não tem data de merge e FICA.
 */
export function aptaParaArquivar(e: EntradaDeAptidao): { apta: boolean; motivo: string } {
  if (!deveArquivar(e.branch, e.headRepo, e.baseRepo)) {
    return { apta: false, motivo: 'permanente, deploy do site ou fork' };
  }
  if (e.prAberta) return { apta: false, motivo: 'tem PR aberta' };
  if (!e.ultimaMergeada) return { apta: false, motivo: 'sem PR mergeada (sem data de merge)' };
  const dias = (e.agora.getTime() - Date.parse(e.ultimaMergeada.mergedAt)) / MS_POR_DIA;
  if (!(dias >= DIAS_ATE_ARQUIVAR)) {
    return { apta: false, motivo: `mergeada há menos de ${DIAS_ATE_ARQUIVAR} dias` };
  }
  if (e.shaAtual !== e.ultimaMergeada.headSha) {
    return { apta: false, motivo: 'recebeu commit depois do merge' };
  }
  return { apta: true, motivo: `mergeada há ${Math.floor(dias)} dias` };
}

// ------------------------------------------------------------- adaptador CLI
//
// A checagem diária: lista as branches de GITHUB_REPOSITORY, decide cada uma
// por `aptaParaArquivar` e arquiva as aptas pela API — cria (ou força)
// `refs/archive/<b>`, confere que aponta para o MESMO SHA e só então apaga
// `refs/heads/<b>`. Falha numa branch não derruba as outras; o resumo vai para
// GITHUB_STEP_SUMMARY e o processo sai 1 se houve alguma falha.

interface Resposta {
  status: number;
  // corpo da API do GitHub, lido campo a campo abaixo
  dados: any;
}

async function api(token: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const r = await fetch(`https://api.github.com/${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null };
}

async function paginado(token: string, caminho: string): Promise<Resposta['dados'][]> {
  const todos: Resposta['dados'][] = [];
  const sep = caminho.includes('?') ? '&' : '?';
  for (let pagina = 1; ; pagina++) {
    const { status, dados } = await api(token, 'GET', `${caminho}${sep}per_page=100&page=${pagina}`);
    if (status !== 200) throw new Error(`GET ${caminho} respondeu ${status}`);
    todos.push(...dados);
    if (dados.length < 100) return todos;
  }
}

async function arquivar(token: string, repo: string, branch: string, sha: string): Promise<void> {
  const ref = refDeArquivo(branch);
  const semPrefixo = ref.slice('refs/'.length);
  const criado = await api(token, 'POST', `repos/${repo}/git/refs`, { ref, sha });
  if (criado.status === 422) {
    // Nome reaproveitado: o arquivo mais RECENTE daquele nome passa a valer.
    const r = await api(token, 'PATCH', `repos/${repo}/git/refs/${semPrefixo}`, { sha, force: true });
    if (r.status !== 200) throw new Error(`PATCH ${ref} respondeu ${r.status}`);
  } else if (criado.status !== 201) {
    throw new Error(`POST ${ref} respondeu ${criado.status}`);
  }
  const conferido = await api(token, 'GET', `repos/${repo}/git/ref/${semPrefixo}`);
  if (conferido.dados?.object?.sha !== sha) {
    throw new Error(`${ref} não aponta para ${sha}; branch mantida`);
  }
  const apagado = await api(token, 'DELETE', `repos/${repo}/git/refs/heads/${branch}`);
  if (apagado.status !== 204) throw new Error(`DELETE refs/heads/${branch} respondeu ${apagado.status}`);
}

async function principal(): Promise<void> {
  const token = process.env.GH_TOKEN ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  if (!token || !repo) {
    console.error('archive-branch: exige GH_TOKEN e GITHUB_REPOSITORY');
    process.exit(2);
  }
  const agora = new Date();
  const dono = repo.split('/')[0];
  const arquivadas: string[] = [];
  const mantidas: string[] = [];
  const falhas: string[] = [];

  for (const b of await paginado(token, `repos/${repo}/branches`)) {
    const branch: string = b.name;
    try {
      const head = encodeURIComponent(`${dono}:${branch}`);
      const prs = await paginado(token, `repos/${repo}/pulls?state=all&head=${head}`);
      const ultima = prs
        .filter((p) => p.merged_at && p.head?.repo?.full_name === repo)
        .sort((x, y) => Date.parse(y.merged_at) - Date.parse(x.merged_at))[0];
      const { apta, motivo } = aptaParaArquivar({
        branch,
        headRepo: repo,
        baseRepo: repo,
        prAberta: prs.some((p) => p.state === 'open'),
        ultimaMergeada: ultima ? { mergedAt: ultima.merged_at, headSha: ultima.head.sha } : null,
        shaAtual: b.commit.sha,
        agora,
      });
      if (!apta) {
        mantidas.push(`\`${branch}\`: ${motivo}`);
        continue;
      }
      await arquivar(token, repo, branch, b.commit.sha);
      arquivadas.push(`\`${branch}\` → \`${refDeArquivo(branch)}\` (${motivo})`);
    } catch (erro) {
      falhas.push(`\`${branch}\`: ${(erro as Error).message}`);
    }
  }

  const secao = (titulo: string, itens: string[]): string =>
    `### ${titulo} (${itens.length})\n\n${itens.map((i) => `- ${i}`).join('\n') || '_nenhuma_'}\n`;
  const resumo = [secao('Arquivadas', arquivadas), secao('Mantidas', mantidas), secao('Falhas', falhas)].join('\n');
  console.log(resumo);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Arquivamento de branches mergeadas\n\n${resumo}`);
  }
  if (falhas.length > 0) process.exit(1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
