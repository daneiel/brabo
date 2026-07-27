/**
 * pr-police — aplica a política de branches em todo PR.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * A lógica que DECIDE é pura e testável; git e GitHub ficam no adaptador CLI no
 * fim do arquivo — mesmo desenho de `scripts/docs/docmap.mjs`.
 *
 * Roda como `node scripts/ci/pr-police.ts`: o Node 24 do CI executa TypeScript
 * direto por type stripping. Isso obriga a usar SÓ sintaxe apagável — nada de
 * `enum`, `namespace` ou parameter property — e `import type` explícito para
 * import usado apenas como tipo. O typecheck de verdade é `pnpm --filter
 * @brabo/scripts typecheck`, no CI.
 */

// ---------------------------------------------------------------- a política

/**
 * A escada, do degrau MAIS avançado para o mais estável.
 *
 * "Avançado" aqui é "contém mais trabalho ainda não validado": `dev` é onde
 * tudo entra primeiro, `main` é o que está no ar. O índice nesta lista é o que
 * define tanto a adjacência da promoção quanto o que conta como contaminação.
 */
export const ESCADA = ['dev', 'qa', 'rc', 'main'] as const;
export type Permanente = (typeof ESCADA)[number];

/** Funções que nascem de `dev` e voltam para `dev`. */
export const FUNCOES_DE_TRABALHO = [
  'breaking',
  'feature',
  'bugfix',
  'perf',
  'refactor',
  'chore',
  'docs',
  'test',
] as const;

/** Correções que nascem no degrau em que o problema apareceu. */
export const FUNCOES_DE_CORRECAO_ALTA = {
  rcfix: 'rc',
  hotfix: 'main',
} as const satisfies Record<string, Permanente>;

export const FORMATO_DA_BRANCH = /^.{0,15}\/\S{0,32}$/;

export type Familia = 'trabalho' | 'promocao' | 'retropropagacao' | 'correcao-alta';

export const FAMILIAS: readonly Familia[] = [
  'trabalho',
  'promocao',
  'retropropagacao',
  'correcao-alta',
];

// ------------------------------------------------------------------- tipos

/**
 * Ancestralidade medida pelo adaptador. `undefined` significa "não deu para
 * medir" (branch inexistente, ref não buscada) — e NUNCA é tratado como
 * `false`: confundir os dois é o falso-verde clássico do
 * `git merge-base --is-ancestor`, que sai 1 para "não" e ≥2 para erro.
 */
export interface Ancestralidade {
  /** `headContem[p]` — o tip de `p` é ancestral do head do PR? */
  headContem: Partial<Record<Permanente, boolean>>;
  /** `contida[a]?.[b]` — o tip de `a` é ancestral de `b`? */
  contida: Partial<Record<Permanente, Partial<Record<Permanente, boolean>>>>;
}

export interface EntradaPr {
  head: string;
  base: string;
  autor?: string;
  /** `type` do autor na API do GitHub — `'Bot'` para apps. */
  tipoDoAutor?: string;
  /** `false` quando o head vem de fork: aí `head` pode ser `main` sem ser promoção. */
  mesmoRepositorio?: boolean;
  ancestralidade?: Ancestralidade;
}

export type CodigoDeViolacao =
  | 'NOME-FORA-DO-FORMATO'
  | 'DESCRITIVO-VAZIO'
  | 'FUNCAO-DESCONHECIDA'
  | 'DESTINO-INVALIDO'
  | 'PROMOCAO-NAO-ADJACENTE'
  | 'ORIGEM-CONTAMINADA';

export interface Violacao {
  codigo: CodigoDeViolacao;
  observado: string;
  regra: string;
  porque: string;
  conserto: string;
}

export interface Veredito {
  ok: boolean;
  familia: Familia | null;
  isento: boolean;
  violacoes: Violacao[];
  /** Não reprovam, mas aparecem na saída — silêncio vira falso-verde. */
  avisos: string[];
}

// ------------------------------------------------------------------ auxiliares

const TODAS_AS_FUNCOES: readonly string[] = [
  ...FUNCOES_DE_TRABALHO,
  ...Object.keys(FUNCOES_DE_CORRECAO_ALTA),
];

function ehPermanente(nome: string): nome is Permanente {
  return (ESCADA as readonly string[]).includes(nome);
}

function funcaoDe(branch: string): string {
  return branch.slice(0, branch.indexOf('/'));
}

/** `dev`→`qa` é +1 (promoção); `qa`→`dev` é −1 (retropropagação). */
function degraus(de: Permanente, para: Permanente): number {
  return ESCADA.indexOf(para) - ESCADA.indexOf(de);
}

export function ehAutorBot(autor?: string, tipoDoAutor?: string): boolean {
  if (tipoDoAutor === 'Bot') return true;
  // O GitHub não permite `[` em login humano, então o sufixo não é forjável.
  // Isentar por AUTOR e não por prefixo de branch é o que impede a brecha de
  // alguém nomear a branch de `dependabot/` para escapar da régua.
  return typeof autor === 'string' && autor.endsWith('[bot]');
}

// -------------------------------------------------- a regra de origem

/**
 * A pergunta certa não é "de onde esta branch nasceu?" — é "ela carrega o que
 * não devia?".
 *
 * Tentar INFERIR a origem por distância de merge-base não funciona, e a falha é
 * estrutural: se `P ⊆ Q ⊆ head`, então `dist(P) ≥ dist(Q)` sempre, e o menor
 * aponta para a permanente mais avançada CONTIDA no head — que só coincide com
 * a origem enquanto a escada está esticada. No instante em que `qa` e `rc`
 * nascem de `dev`, as três empatam e o sinal é zero. Justamente o `hotfix`,
 * que tem a aprovação mais dura, seria o indistinguível.
 *
 * A verificação de contaminação não infere nada. O prefixo JÁ declara a origem;
 * o que se checa é se o head contém o tip de alguma permanente **estritamente
 * mais avançada** que a origem declarada:
 *
 *   hotfix (main) → não pode conter rc, qa nem dev
 *   rcfix  (rc)   → não pode conter qa nem dev
 *   trabalho (dev)→ dev é o topo: nada a verificar
 *
 * Trabalho não tem verificação de propósito. Uma `feature` que nasceu de `main`
 * por engano não introduz nada estranho em `dev` — a política só precisa pegar
 * contaminação para BAIXO, que é a que leva código não validado à produção.
 *
 * "Estritamente mais avançada" é dinâmico, não a ordem fixa: `Q` só conta se
 * tiver commits que a origem não tem. Sem isso, logo depois de cada promoção
 * (quando `qa` vira ancestral de `rc`) todo `rcfix` legítimo viraria falso
 * positivo.
 */
export function verificarContaminacao(
  origemDeclarada: Permanente,
  ancestralidade?: Ancestralidade,
): { contaminadaPor: Permanente[]; naoVerificado: Permanente[] } {
  const contaminadaPor: Permanente[] = [];
  const naoVerificado: Permanente[] = [];

  const iOrigem = ESCADA.indexOf(origemDeclarada);
  // Índice menor = mais avançado.
  const maisAvancadas = ESCADA.slice(0, iOrigem);

  for (const q of maisAvancadas) {
    const qContidaNaOrigem = ancestralidade?.contida?.[q]?.[origemDeclarada];
    // `q` já está dentro da origem: conter o tip dela não prova nada.
    if (qContidaNaOrigem === true) continue;

    const headContemQ = ancestralidade?.headContem?.[q];
    if (headContemQ === undefined || qContidaNaOrigem === undefined) {
      naoVerificado.push(q);
      continue;
    }
    if (headContemQ) contaminadaPor.push(q);
  }

  return { contaminadaPor, naoVerificado };
}

// ------------------------------------------------------------- as mensagens

const LISTA_DE_FUNCOES = TODAS_AS_FUNCOES.join(', ');

const SUGESTAO_POR_ENGANO: Record<string, string> = {
  fix: 'Correção comum é `bugfix`; incidente em produção é `hotfix`.',
  hotfixes: 'O singular: `hotfix`.',
  feat: 'O nome completo: `feature`.',
  ci: 'Mudança de CI, tooling ou manutenção é `chore`.',
  build: 'Mudança de build é `chore`.',
  infra: 'Mudança de infraestrutura é `chore`.',
  style: 'Formatação sem mudar comportamento é `refactor`.',
  spike: 'Experimento descartável é `chore`.',
};

// ------------------------------------------------------------ a avaliação

export function avaliarPr(entrada: EntradaPr): Veredito {
  const head = entrada.head.trim();
  const base = entrada.base.trim();
  const violacoes: Violacao[] = [];
  const avisos: string[] = [];

  // 1. Isenção primeiro. Mensagem pedagógica não ensina robô, e o Dependabot
  //    não tem como aprender a taxonomia.
  if (ehAutorBot(entrada.autor, entrada.tipoDoAutor)) {
    return {
      ok: true,
      familia: null,
      isento: true,
      violacoes: [],
      avisos: [`autor isento: ${entrada.autor ?? '(bot)'}`],
    };
  }

  const doMesmoRepo = entrada.mesmoRepositorio !== false;

  // 2. PR entre permanentes ANTES do regex. `main` não tem barra: invertida, a
  //    ordem faria todo PR de promoção receber "use funcao/descritivo".
  //    Um head chamado `main` vindo de FORK não é promoção — é branch de
  //    trabalho mal nomeada no fork de alguém.
  if (ehPermanente(head) && doMesmoRepo) {
    if (!ehPermanente(base)) {
      violacoes.push({
        codigo: 'DESTINO-INVALIDO',
        observado: `\`${head}\` é branch permanente e mira \`${base}\`, que não é`,
        regra: 'Permanente só mira permanente: promoção sobe um degrau, retropropagação desce um.',
        porque:
          'Uma permanente apontando para branch efêmera inverteria o fluxo — o ' +
          'trabalho é que entra na escada, não o contrário.',
        conserto: `gh pr edit <n> --base ${ESCADA[Math.min(ESCADA.indexOf(head) + 1, ESCADA.length - 1)]}`,
      });
      return { ok: false, familia: null, isento: false, violacoes, avisos };
    }

    const delta = degraus(head, base);

    if (delta === 0) {
      violacoes.push({
        codigo: 'DESTINO-INVALIDO',
        observado: `\`${head}\` → \`${base}\`: origem e destino são a mesma branch`,
        regra: 'Promoção e retropropagação acontecem entre degraus diferentes.',
        porque: 'Um PR de uma branch para ela mesma não tem o que mergear.',
        conserto: 'Confira a base do PR: `gh pr edit <n> --base <outra-permanente>`',
      });
      return { ok: false, familia: null, isento: false, violacoes, avisos };
    }

    if (Math.abs(delta) > 1) {
      const passo = delta > 0 ? 1 : -1;
      const caminho: string[] = [];
      for (let i = ESCADA.indexOf(head); i !== ESCADA.indexOf(base); i += passo) {
        caminho.push(`\`${ESCADA[i]}\` → \`${ESCADA[i + passo]}\``);
      }
      const pulados = ESCADA.slice(
        Math.min(ESCADA.indexOf(head), ESCADA.indexOf(base)) + 1,
        Math.max(ESCADA.indexOf(head), ESCADA.indexOf(base)),
      );

      violacoes.push({
        codigo: 'PROMOCAO-NAO-ADJACENTE',
        observado: `\`${head}\` → \`${base}\` pula ${pulados.map((p) => `\`${p}\``).join(' e ')}`,
        regra: 'Promoção e retropropagação só entre par ADJACENTE: dev → qa → rc → main.',
        porque:
          'Cada degrau é um ambiente com sua verificação. Pular promove para ' +
          'um ambiente código que nunca rodou no anterior, e a tag do degrau ' +
          'passa a não ter a do degrau de baixo correspondente.',
        conserto: `Faça em etapas: ${caminho.join(', depois ')}.\n            gh pr edit <n> --base ${ESCADA[ESCADA.indexOf(head) + passo]}`,
      });
      return { ok: false, familia: null, isento: false, violacoes, avisos };
    }

    return {
      ok: true,
      familia: delta === 1 ? 'promocao' : 'retropropagacao',
      isento: false,
      violacoes: [],
      avisos,
    };
  }

  // 3. Formato do nome.
  if (!FORMATO_DA_BRANCH.test(head) || !head.includes('/')) {
    violacoes.push({
      codigo: 'NOME-FORA-DO-FORMATO',
      observado: `a branch \`${head}\` não tem o formato funcao/descritivo`,
      regra:
        'Nome de branch de trabalho casa com ^.{0,15}/\\S{0,32}$ — uma função, ' +
        'uma barra, um descritivo sem espaços (até 15 e 32 caracteres).',
      porque:
        'A função antes da barra decide destino, aprovadores e o impacto na ' +
        'versão do ciclo. Sem ela, nada disso é calculável.',
      conserto:
        `git branch -m ${head} feature/${head || 'descritivo'}\n` +
        `            git push origin -u feature/${head || 'descritivo'}\n\n` +
        `            ${head}  → rejeitada\n` +
        `            feature/${head || 'descritivo'}  → aceita`,
    });
    // Sem função reconhecível não dá para checar origem nem destino — empilhar
    // erro derivado do primeiro só confunde quem lê.
    return { ok: false, familia: null, isento: false, violacoes, avisos };
  }

  const funcao = funcaoDe(head);
  const descritivo = head.slice(head.indexOf('/') + 1);

  if (descritivo.length === 0) {
    violacoes.push({
      codigo: 'DESCRITIVO-VAZIO',
      observado: `a branch \`${head}\` não tem descritivo depois da barra`,
      regra: 'O formato é funcao/descritivo — as duas partes são obrigatórias.',
      porque:
        'O descritivo é o que identifica a branch numa lista de trinta. ' +
        '`feature/` sozinho não diz nada a ninguém.',
      conserto: `git branch -m ${head} ${funcao}/o-que-voce-esta-fazendo`,
    });
    return { ok: false, familia: null, isento: false, violacoes, avisos };
  }

  if (!TODAS_AS_FUNCOES.includes(funcao)) {
    const sugestao = SUGESTAO_POR_ENGANO[funcao.toLowerCase()];
    violacoes.push({
      codigo: 'FUNCAO-DESCONHECIDA',
      observado: `a branch \`${head}\` usa a função \`${funcao}\``,
      regra: `A lista é fechada: ${LISTA_DE_FUNCOES}.`,
      porque:
        'A função alimenta o cálculo de versão do ciclo (breaking → MAJOR, ' +
        'feature → MINOR, resto → PATCH). Fora da tabela, sairia como PATCH ' +
        'em silêncio.',
      conserto:
        (sugestao ? `${sugestao}\n            ` : '') +
        `git branch -m ${head} feature/${descritivo}`,
    });
    return { ok: false, familia: null, isento: false, violacoes, avisos };
  }

  const ehCorrecaoAlta = funcao in FUNCOES_DE_CORRECAO_ALTA;
  const origem: Permanente = ehCorrecaoAlta
    ? FUNCOES_DE_CORRECAO_ALTA[funcao as keyof typeof FUNCOES_DE_CORRECAO_ALTA]
    : 'dev';

  // 4. Destino.
  if (base !== origem) {
    violacoes.push({
      codigo: 'DESTINO-INVALIDO',
      observado: `\`${head}\` mira \`${base}\`, mas \`${funcao}/\` volta para \`${origem}\``,
      regra: `\`${funcao}/\` nasce de \`${origem}\` e o PR dela mira \`${origem}\`.`,
      porque:
        'Código sobe um degrau por vez, e sempre por PR entre permanentes. ' +
        `Mirar \`${base}\` direto pularia a verificação dos degraus do meio.`,
      conserto:
        `gh pr edit <n> --base ${origem}\n\n` +
        `            Para levar o que já está em \`${origem}\` até \`${base}\`, o PR é\n` +
        `            entre as permanentes, depois deste aqui ser mergeado.`,
    });
  }

  // 5. Contaminação de origem.
  const { contaminadaPor, naoVerificado } = verificarContaminacao(
    origem,
    entrada.ancestralidade,
  );

  if (contaminadaPor.length > 0) {
    const lista = contaminadaPor.map((p) => `\`${p}\``).join(', ');
    violacoes.push({
      codigo: 'ORIGEM-CONTAMINADA',
      observado: `\`${head}\` contém o tip de ${lista} — logo não nasceu de \`${origem}\``,
      regra: `\`${funcao}/\` nasce de \`${origem}\`, e não pode carregar commits que só existem em degraus acima.`,
      porque:
        origem === 'main'
          ? 'Hotfix vai direto para produção. Nascendo de outro degrau, o merge ' +
            'leva junto tudo que ainda está em desenvolvimento — um deploy de ' +
            'emergência vira um release inteiro não revisado.'
          : 'Rcfix corrige o que foi achado na preprod. Nascendo de um degrau ' +
            'acima, carrega junto o que ainda não chegou lá.',
      conserto:
        `git fetch origin ${origem}\n` +
        `            git checkout -b ${head}-limpa origin/${origem}\n` +
        `            git cherry-pick <sha-do-conserto>   # só o conserto\n` +
        `            git push origin -u ${head}-limpa`,
    });
  }

  if (naoVerificado.length > 0) {
    avisos.push(
      `origem não verificada contra ${naoVerificado.map((p) => `\`${p}\``).join(', ')}: ` +
        'a branch não existe no remoto ou a ancestralidade não pôde ser medida. ' +
        'A checagem de contaminação foi parcial.',
    );
  }

  return {
    ok: violacoes.length === 0,
    familia: violacoes.length === 0 ? (ehCorrecaoAlta ? 'correcao-alta' : 'trabalho') : null,
    isento: false,
    violacoes,
    avisos,
  };
}

// -------------------------------------------------------------- a renderização

export function formatarVeredito(entrada: EntradaPr, veredito: Veredito): string {
  const l: string[] = [];
  l.push(`pr-police: ${entrada.head} → ${entrada.base}`);
  l.push('');

  for (const aviso of veredito.avisos) l.push(`  ⚠ ${aviso}`);
  if (veredito.avisos.length > 0) l.push('');

  if (veredito.ok) {
    l.push(
      veredito.isento
        ? '  ✓ ISENTO — PR de bot não passa pela régua de nome, origem e destino.'
        : `  ✓ APROVADO — família: ${veredito.familia}`,
    );
    return l.join('\n');
  }

  const n = veredito.violacoes.length;
  l.push(`  ✗ REPROVADO — ${n} ${n === 1 ? 'violação' : 'violações'}`);

  for (const v of veredito.violacoes) {
    l.push('');
    l.push(`  [${v.codigo}]  ${v.observado}`);
    l.push(`    regra:    ${v.regra}`);
    l.push(`    porquê:   ${v.porque}`);
    l.push(`    conserto: ${v.conserto}`);
  }

  l.push('');
  l.push('  A política inteira: docs/explanation/branching-policy.md');
  return l.join('\n');
}

// ------------------------------------------------------------- adaptador CLI

/**
 * `pathToFileURL` e não a template string `file://${argv[1]}`: o idioma ingênuo
 * falha em caminho com espaço ou acento, e a falha é silenciosa — o bloco não
 * roda e o script sai 0 sem ter verificado nada.
 */
async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const head = process.env.PR_HEAD_REF ?? '';
  const base = process.env.PR_BASE_REF ?? '';
  const headSha = process.env.PR_HEAD_SHA ?? '';

  if (!head || !base) {
    console.error('[pr-police] PR_HEAD_REF e PR_BASE_REF são obrigatórios.');
    process.exit(2);
  }

  /**
   * `git merge-base --is-ancestor` sai 0 para sim, 1 para não e >=2 para ERRO.
   * Tratar erro como "não" é o falso-verde clássico: uma ref não buscada faria
   * toda checagem de contaminação passar. Erro vira `undefined`, que a regra
   * reporta como não verificado em vez de aprovar em silêncio.
   */
  const ehAncestral = (a: string, b: string): boolean | undefined => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
      return true;
    } catch (erro) {
      const status = (erro as { status?: number }).status;
      return status === 1 ? false : undefined;
    }
  };

  const existe = (ref: string): boolean => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  const alvo = headSha || 'HEAD';
  const ancestralidade: Ancestralidade = { headContem: {}, contida: {} };

  for (const p of ESCADA) {
    const refP = `origin/${p}`;
    if (!existe(refP)) continue;

    ancestralidade.headContem[p] = ehAncestral(refP, alvo);
    ancestralidade.contida[p] = {};
    for (const q of ESCADA) {
      const refQ = `origin/${q}`;
      if (p === q || !existe(refQ)) continue;
      ancestralidade.contida[p]![q] = ehAncestral(refP, refQ);
    }
  }

  const entrada: EntradaPr = {
    head,
    base,
    autor: process.env.PR_AUTOR,
    tipoDoAutor: process.env.PR_AUTOR_TIPO,
    mesmoRepositorio: process.env.PR_MESMO_REPO !== 'false',
    ancestralidade,
  };

  const veredito = avaliarPr(entrada);
  const saida = formatarVeredito(entrada, veredito);
  console.log(saida);

  for (const v of veredito.violacoes) {
    console.log(`::error title=pr-police: ${v.codigo}::${v.observado}. ${v.regra}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `familia=${veredito.familia ?? ''}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `ok=${veredito.ok}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### pr-police\n\n\`\`\`\n${saida}\n\`\`\`\n`,
    );
  }

  process.exit(veredito.ok ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
