/**
 * dependabot-para-dev — decide o que fazer com um PR do Dependabot aberto
 * contra `main`. Fonte da política: docs/explanation/branching-policy.md,
 * seção "Dependabot enters through dev".
 *
 * Por que isto existe: dependência entra pela `dev`, como todo o resto, e
 * chega à `main` pela promoção `dev → qa → main`. O `target-branch: dev` do
 * `.github/dependabot.yml` resolve isso para as atualizações de VERSÃO, mas os
 * SECURITY UPDATES são ligados na interface do repositório e o GitHub os abre
 * SEMPRE contra a branch default, ignorando `target-branch`. Com `main` como
 * default e a `dev` à frente dela, o que chega é quase sempre correção que a
 * `dev` já tem — o #526 e o #553 foram exatamente isso, fechados à mão.
 *
 * Duas decisões, e nenhuma terceira:
 *
 * - `fechar` — TODA dependência que o PR sobe já resolve, no lockfile da `dev`,
 *   só em versões >= o LIMIAR dela. A correção já está onde o trabalho acontece.
 * - `redirecionar` — qualquer outra coisa: alguma versão resolvida abaixo do
 *   destino, pacote ausente do lockfile, versão que não se compara (`link:`,
 *   `file:`), ou corpo do PR em que nenhuma atualização foi reconhecida.
 *
 * O LIMIAR é a primeira versão CORRIGIDA dos alertas abertos daquele pacote
 * naquele lockfile, e só na falta deles é a versão de destino do PR. A
 * diferença foi medida no #553: ele subia `@vitest/mocker` de 4.1.10 para
 * 5.0.0, a `dev` resolvia 4.1.11 — e 4.1.11 é a primeira corrigida do alerta.
 * Comparar com o destino teria redirecionado uma correção que a `dev` já
 * tinha; o Dependabot propõe a versão mais NOVA, não a mínima que corrige.
 *
 * O desenho falha FECHADO no sentido que importa: na dúvida o PR é
 * REDIRECIONADO, nunca fechado. Fechar às cegas uma correção de segurança é o
 * erro caro; redirecionar uma redundante custa um PR a mais para alguém fechar.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

export interface Atualizacao {
  nome: string;
  de: string;
  para: string;
}

/** O recorte de um alerta do Dependabot que a decisão usa (API REST). */
export interface Alerta {
  dependency: { package: { name: string }; manifest_path: string };
  security_vulnerability: { first_patched_version: { identifier: string } | null };
}

export type Decisao =
  | { decisao: 'fechar'; motivo: string }
  | { decisao: 'redirecionar'; motivo: string };

/**
 * Lê as linhas "Updates `pkg` from X to Y" do corpo do PR — o formato que o
 * Dependabot usa tanto em PR de um pacote quanto de grupo.
 */
export function extrairAtualizacoes(corpo: string): Atualizacao[] {
  const padrao = /Updates `([^`]+)` from (\S+) to (\S+?)[.,;:]?(?=\s|$)/g;
  const vistas = new Map<string, Atualizacao>();
  for (const m of corpo.matchAll(padrao)) {
    const [, nome = '', de = '', para = ''] = m;
    vistas.set(`${nome}@${para}`, { nome, de, para });
  }
  return [...vistas.values()];
}

/**
 * O diretório do manifesto que o PR mexe (`/` ou `/website`), lido da frase
 * "in the /website directory". Sem a frase, a raiz.
 */
export function diretorioDoManifesto(corpo: string): string {
  const m = /\bin the (\/\S*) directory\b/.exec(corpo);
  return m?.[1] ?? '/';
}

/**
 * Todas as versões de `nome` que o lockfile resolve. Casa as chaves de
 * `packages:` e de `snapshots:` do formato do pnpm (com ou sem aspas, com ou
 * sem sufixo de peer entre parênteses).
 */
export function versoesResolvidas(lockfile: string, nome: string): string[] {
  const versoes = new Set<string>();
  for (const linha of lockfile.split('\n')) {
    const m = /^ {2}'?((?:@[^/\s']+\/)?[^@\s'(]+)@([^(':\s]+)/.exec(linha);
    if (m?.[1] === nome && m[2]) versoes.add(m[2]);
  }
  return [...versoes];
}

/**
 * Compara duas versões semver. Devolve negativo, zero ou positivo; `null`
 * quando alguma das duas não é semver comparável.
 */
export function compararVersoes(a: string, b: string): number | null {
  const partes = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+\S*)?$/.exec(v);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] } : null;
  };
  const pa = partes(a);
  const pb = partes(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const na = pa.nums[i] ?? 0;
    const nb = pb.nums[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  // Pré-release vem ANTES da versão final (1.0.0-rc.1 < 1.0.0).
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** `/` → `pnpm-lock.yaml`; `/website` → `website/pnpm-lock.yaml`. */
export function manifestoDoDiretorio(diretorio: string): string {
  const semBarras = diretorio.replace(/^\/+|\/+$/g, '');
  return semBarras ? `${semBarras}/pnpm-lock.yaml` : 'pnpm-lock.yaml';
}

/**
 * O limiar de uma atualização: a MAIOR primeira-versão-corrigida entre os
 * alertas abertos do pacote no manifesto, ou o destino do PR quando não há
 * alerta que diga (atualização de versão, ou alerta sem versão corrigida).
 */
export function limiar(atualizacao: Atualizacao, alertas: Alerta[], manifesto: string): string {
  let maior: string | null = null;
  for (const a of alertas) {
    if (a.dependency.package.name !== atualizacao.nome) continue;
    if (a.dependency.manifest_path !== manifesto) continue;
    const corrigida = a.security_vulnerability.first_patched_version?.identifier;
    if (!corrigida) return atualizacao.para;
    if (maior === null) {
      maior = corrigida;
      continue;
    }
    const cmp = compararVersoes(corrigida, maior);
    if (cmp === null) return atualizacao.para;
    if (cmp > 0) maior = corrigida;
  }
  return maior ?? atualizacao.para;
}

export function decidir(
  atualizacoes: Atualizacao[],
  lockfileDaDev: string,
  alertas: Alerta[] = [],
  manifesto = 'pnpm-lock.yaml',
): Decisao {
  if (atualizacoes.length === 0) {
    return {
      decisao: 'redirecionar',
      motivo: 'nenhuma atualização reconhecida no corpo do PR — na dúvida, redireciona',
    };
  }

  const jaResolvidas: string[] = [];
  for (const atualizacao of atualizacoes) {
    const { nome } = atualizacao;
    const para = limiar(atualizacao, alertas, manifesto);
    const versoes = versoesResolvidas(lockfileDaDev, nome);
    if (versoes.length === 0) {
      return {
        decisao: 'redirecionar',
        motivo: `\`${nome}\` não aparece no lockfile da \`dev\``,
      };
    }
    for (const v of versoes) {
      const cmp = compararVersoes(v, para);
      if (cmp === null) {
        return {
          decisao: 'redirecionar',
          motivo: `\`${nome}@${v}\` na \`dev\` não é comparável com \`${para}\``,
        };
      }
      if (cmp < 0) {
        return {
          decisao: 'redirecionar',
          motivo: `a \`dev\` ainda resolve \`${nome}@${v}\`, abaixo de \`${para}\``,
        };
      }
    }
    jaResolvidas.push(`\`${nome}\` (${versoes.sort().join(', ')} >= ${para})`);
  }

  return {
    decisao: 'fechar',
    motivo: `a \`dev\` já resolve ${jaResolvidas.join('; ')}`,
  };
}

// ------------------------------------------------------------- adaptador CLI
//
// uso: dependabot-para-dev.ts <arquivo-com-o-corpo> <raiz-do-checkout-da-dev> [alertas.json]
//
// `alertas.json` é a resposta de `GET /repos/:repo/dependabot/alerts?state=open`.
// Ausente ou ilegível, a decisão compara com o destino do PR — mais estrita,
// então só pode REDIRECIONAR a mais, nunca fechar a mais.
//
// Imprime em stdout UMA linha JSON `{decisao, motivo, diretorio}`. O workflow
// decide o resto (fechar ou trocar a base) via `gh` — este módulo carrega só a
// POLÍTICA, que é a parte que erra na prática.

async function principal(): Promise<void> {
  const [, , arquivoDoCorpo = '', raiz = '', arquivoDeAlertas = ''] = process.argv;
  if (!arquivoDoCorpo || !raiz) {
    console.error('uso: dependabot-para-dev.ts <arquivo-com-o-corpo> <raiz-do-checkout-da-dev>');
    process.exit(2);
  }

  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  const corpo = readFileSync(arquivoDoCorpo, 'utf8');
  const diretorio = diretorioDoManifesto(corpo);
  const caminhoDoLock = join(raiz, diretorio, 'pnpm-lock.yaml');

  let resultado: Decisao;
  if (!existsSync(caminhoDoLock)) {
    resultado = {
      decisao: 'redirecionar',
      motivo: `sem \`pnpm-lock.yaml\` em \`${diretorio}\` na \`dev\` (ecossistema sem lockfile, ou diretório novo)`,
    };
  } else {
    let alertas: Alerta[] = [];
    if (arquivoDeAlertas && existsSync(arquivoDeAlertas)) {
      try {
        const lidos: unknown = JSON.parse(readFileSync(arquivoDeAlertas, 'utf8'));
        if (Array.isArray(lidos)) alertas = lidos as Alerta[];
      } catch {
        console.error('dependabot-para-dev: alertas ilegíveis — comparando com o destino do PR');
      }
    }
    resultado = decidir(
      extrairAtualizacoes(corpo),
      readFileSync(caminhoDoLock, 'utf8'),
      alertas,
      manifestoDoDiretorio(diretorio),
    );
  }

  console.log(JSON.stringify({ ...resultado, diretorio }));
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
