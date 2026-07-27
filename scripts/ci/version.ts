/**
 * version — calcula a versão do ciclo, o N de cada estágio e verifica a âncora
 * da tag final.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * A VERSÃO VIVE NA TAG, não nos arquivos. Ninguém pode commitar direto numa
 * branch permanente para bumpar `package.json`, então tentar manter os quatro
 * arquivos de versão em dia obrigaria a um PR de bump por ciclo — cerimônia que
 * o cálculo automático existe para eliminar. O `release.yml` confere os
 * arquivos como AVISO, e só dispara em tag final.
 *
 * Tudo aqui é puro: recebe listas de tags e de impactos, devolve strings. Quem
 * fala com git e com a API é o adaptador CLI no fim.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { ESCADA, type Permanente } from './pr-police.ts';

// ---------------------------------------------------------------- a política

/** O estágio de pré-lançamento de cada permanente. `main` não tem: é final. */
export const ESTAGIO_POR_BRANCH = {
  dev: 'dev',
  qa: 'qa',
  main: null,
} as const satisfies Record<Permanente, string | null>;

export type Estagio = 'dev' | 'qa';

export const IMPACTOS = ['major', 'minor', 'patch'] as const;
export type Impacto = (typeof IMPACTOS)[number];

/**
 * O impacto de um PR sai da FUNÇÃO da branch dele. `breaking` sobe MAJOR,
 * `feature` sobe MINOR, todo o resto é PATCH.
 *
 * A label de família (`trabalho`, `promocao`, …) NÃO serve para isto: ela
 * classifica o tipo de PR na esteira, não o tamanho da mudança. Um
 * `breaking/x` e um `docs/y` são ambos da família `trabalho`.
 */
export const IMPACTO_POR_FUNCAO: Record<string, Impacto> = {
  breaking: 'major',
  feature: 'minor',
};

export interface PrDoCiclo {
  numero: number;
  titulo: string;
  /** Nome da branch de origem — é dela que sai a função. */
  branch: string;
}

export interface PrClassificado extends PrDoCiclo {
  funcao: string;
  impacto: Impacto;
}

// ------------------------------------------------------------------- semver

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_COM_ESTAGIO = /^v(\d+)\.(\d+)\.(\d+)-(dev|qa)\.(\d+)$/;

export interface Versao {
  major: number;
  minor: number;
  patch: number;
}

export function lerVersaoFinal(tag: string): Versao | null {
  const m = SEMVER.exec(tag.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function escreverVersao(v: Versao): string {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

export interface TagDeEstagio {
  versao: string;
  estagio: Estagio;
  n: number;
}

export function lerTagDeEstagio(tag: string): TagDeEstagio | null {
  const m = SEMVER_COM_ESTAGIO.exec(tag.trim());
  if (!m) return null;
  return {
    versao: `v${m[1]}.${m[2]}.${m[3]}`,
    estagio: m[4] as Estagio,
    n: Number(m[5]),
  };
}

// ------------------------------------------------------- classificar o ciclo

export function classificar(prs: PrDoCiclo[]): PrClassificado[] {
  return prs.map((pr) => {
    const funcao = pr.branch.includes('/') ? pr.branch.slice(0, pr.branch.indexOf('/')) : pr.branch;
    return { ...pr, funcao, impacto: IMPACTO_POR_FUNCAO[funcao] ?? 'patch' };
  });
}

/** O MAIOR impacto do ciclo manda: um `breaking` no meio de dez `docs` é MAJOR. */
export function maiorImpacto(classificados: PrClassificado[]): Impacto | null {
  if (classificados.length === 0) return null;
  for (const nivel of IMPACTOS) {
    if (classificados.some((c) => c.impacto === nivel)) return nivel;
  }
  return 'patch';
}

export class CicloVazioError extends Error {
  constructor(desde: string) {
    super(
      `nenhum PR mergeado desde ${desde} — não há o que promover.\n` +
        '  Promoção sem mudança geraria uma tag nova apontando para o mesmo\n' +
        '  commit da anterior, o que faz o histórico de versões mentir.\n' +
        '  Mergeie ao menos um PR em `dev` antes de promover.',
    );
    this.name = 'CicloVazioError';
  }
}

/**
 * A versão do ciclo, a partir da última FINAL e dos PRs mergeados desde ela.
 *
 * `0.x` não recebe tratamento especial: `breaking` sobe MAJOR mesmo saindo de
 * `0.1.0` para `1.0.0`. Quem não quer isso não deve nomear a branch de
 * `breaking/`.
 */
export function proximaVersao(ultimaFinal: string | null, prs: PrDoCiclo[]): string {
  const classificados = classificar(prs);
  const impacto = maiorImpacto(classificados);

  if (impacto === null) throw new CicloVazioError(ultimaFinal ?? 'o início do repositório');

  const base = ultimaFinal ? lerVersaoFinal(ultimaFinal) : null;
  const v: Versao = base ?? { major: 0, minor: 0, patch: 0 };

  if (impacto === 'major') return escreverVersao({ major: v.major + 1, minor: 0, patch: 0 });
  if (impacto === 'minor') return escreverVersao({ major: v.major, minor: v.minor + 1, patch: 0 });
  return escreverVersao({ major: v.major, minor: v.minor, patch: v.patch + 1 });
}

// ---------------------------------------------------------------------- o N

/**
 * O N do próximo carimbo daquela versão naquele estágio.
 *
 * N = quantas já existem + 1. Não há estado guardado em lugar nenhum: as
 * próprias tags são o contador. É isso que faz "reprovou, corrigiu, promoveu
 * de novo" virar `-qa.2` sem ninguém anotar a reprovação — e o número passa a
 * dizer quantas voltas o ciclo deu antes de passar.
 */
export function proximoN(tags: string[], versao: string, estagio: Estagio): number {
  const existentes = tags
    .map(lerTagDeEstagio)
    .filter((t): t is TagDeEstagio => t !== null && t.versao === versao && t.estagio === estagio);

  return existentes.length === 0 ? 1 : Math.max(...existentes.map((t) => t.n)) + 1;
}

export function montarTag(versao: string, estagio: Estagio, n: number): string {
  return `${versao}-${estagio}.${n}`;
}

// ------------------------------------------------------------------- a âncora

export interface Ancora {
  ok: boolean;
  tagEsperada: string | null;
  motivo?: string;
}

/**
 * O que a âncora precisa saber além do sha, para funcionar com merge commit.
 *
 * Sem isto a verificação é impossível de passar: promoção é `--no-ff`, o merge
 * CRIA um commit novo, e o sha de `main` nunca vai ser o sha de `qa`.
 */
export interface ContextoDaAncora {
  /** A árvore do commit de `main` — é o que diz se o CONTEÚDO é o mesmo. */
  treeDoCommit: string;
  /** A árvore de cada tag, para comparar com a da última `-qa.N`. */
  treePorTag: Record<string, string>;
  /** Os pais do commit de `main`. */
  paisDoCommit: string[];
}

/**
 * A tag final SÓ pode nascer no commit da última `-qa.N` daquela versão.
 *
 * É a verificação que impede publicar algo diferente do que foi validado. Sem
 * ela, um commit que entrasse em `main` entre a validação e a publicação sairia
 * com o carimbo de aprovado. Falha ruidosa de propósito.
 */
export function verificarAncora(
  versao: string,
  tags: string[],
  shaPorTag: Record<string, string>,
  shaDoCommit: string,
  contexto?: ContextoDaAncora,
): Ancora {
  const doEstagio = tags
    .map((t) => ({ tag: t, lida: lerTagDeEstagio(t) }))
    .filter((x) => x.lida !== null && x.lida.versao === versao && x.lida.estagio === 'qa');

  if (doEstagio.length === 0) {
    return {
      ok: false,
      tagEsperada: null,
      motivo:
        `não existe nenhuma tag \`${versao}-qa.N\`.\n` +
        `  A final só nasce do commit que passou por \`qa\` — promova por lá antes.`,
    };
  }

  const ultima = doEstagio.reduce((a, b) => (a.lida!.n >= b.lida!.n ? a : b));
  const shaDaUltima = shaPorTag[ultima.tag];

  if (shaDaUltima === undefined) {
    return {
      ok: false,
      tagEsperada: ultima.tag,
      motivo: `não consegui resolver o commit de \`${ultima.tag}\` — verificação impossível, e por isso reprovada.`,
    };
  }

  // Caso 1: o mesmo commit. Acontece num fast-forward.
  if (shaDaUltima === shaDoCommit) return { ok: true, tagEsperada: ultima.tag };

  // Caso 2: MERGE COMMIT — o normal, porque promoção é `--no-ff`.
  //
  // Aqui os shas NUNCA vão bater: o merge cria um commit novo. O que precisa
  // valer são duas coisas, e juntas elas são mais fortes que igualdade de sha:
  //
  //   a) a `-qa.N` é PAI direto do commit — foi ela que entrou, não um
  //      ancestral qualquer que passou por perto;
  //   b) a ÁRVORE é idêntica — o conteúdo publicado é byte a byte o que foi
  //      validado, mesmo o merge tendo dois lados.
  //
  // (b) é o que realmente importa: se o outro lado do merge trouxesse um
  // arquivo, a árvore mudaria e a verificação reprovaria — que é exatamente o
  // caso que a âncora existe para pegar.
  if (contexto) {
    const ehPai = contexto.paisDoCommit.includes(shaDaUltima);
    const treeDaUltima = contexto.treePorTag[ultima.tag];

    if (treeDaUltima === undefined) {
      return {
        ok: false,
        tagEsperada: ultima.tag,
        motivo: `não consegui resolver a árvore de \`${ultima.tag}\` — verificação impossível, e por isso reprovada.`,
      };
    }

    if (ehPai && treeDaUltima === contexto.treeDoCommit) {
      return { ok: true, tagEsperada: ultima.tag };
    }

    if (!ehPai) {
      return {
        ok: false,
        tagEsperada: ultima.tag,
        motivo:
          `\`${ultima.tag}\` (${shaDaUltima.slice(0, 8)}) NÃO é pai do commit de ` +
          `\`main\` (${shaDoCommit.slice(0, 8)}).\n` +
          `  A promoção não trouxe esse commit direto: algo entrou no meio do\n` +
          `  caminho, e a final carimbaria como aprovado um estado que ninguém\n` +
          `  validou.`,
      };
    }

    return {
      ok: false,
      tagEsperada: ultima.tag,
      motivo:
        `a árvore de \`main\` (${contexto.treeDoCommit.slice(0, 8)}) difere da de ` +
        `\`${ultima.tag}\` (${treeDaUltima.slice(0, 8)}).\n` +
        `  O merge trouxe conteúdo do outro lado, então o que seria publicado\n` +
        `  NÃO é o que passou por \`qa\`.`,
    };
  }

  return {
    ok: false,
    tagEsperada: ultima.tag,
    motivo:
      `o commit de \`main\` (${shaDoCommit.slice(0, 8)}) NÃO é o de ` +
      `\`${ultima.tag}\` (${shaDaUltima.slice(0, 8)}), e não recebi a árvore nem\n` +
      `  os pais para verificar a promoção por merge commit.`,
  };
}

// -------------------------------------------------------------- a promoção

export interface ParDaEsteira {
  de: Permanente;
  para: Permanente;
}

export function lerPar(entrada: string): ParDaEsteira | null {
  const [de, para] = entrada.split(/\s*(?:->|→|:)\s*/).map((s) => s.trim());
  if (!de || !para) return null;
  if (!(ESCADA as readonly string[]).includes(de)) return null;
  if (!(ESCADA as readonly string[]).includes(para)) return null;
  return { de: de as Permanente, para: para as Permanente };
}

export function parEhAdjacente(par: ParDaEsteira): boolean {
  return ESCADA.indexOf(par.para) - ESCADA.indexOf(par.de) === 1;
}

/** Mensagem que ENSINA o caminho, em vez de só recusar o par. */
export function explicarParInvalido(par: ParDaEsteira): string {
  const i = ESCADA.indexOf(par.de);
  const j = ESCADA.indexOf(par.para);

  if (i === j) return `\`${par.de}\` → \`${par.para}\`: origem e destino são a mesma branch.`;
  if (j < i) {
    return (
      `\`${par.de}\` → \`${par.para}\` desce a escada. Promoção sobe.\n` +
      '  Descer é retropropagação, e ela nasce de um hotfix, não de um dispatch.'
    );
  }

  const etapas: string[] = [];
  for (let k = i; k < j; k++) etapas.push(`\`${ESCADA[k]}\` → \`${ESCADA[k + 1]}\``);
  return (
    `\`${par.de}\` → \`${par.para}\` pula ${ESCADA.slice(i + 1, j).map((p) => `\`${p}\``).join(', ')}.\n` +
    `  A escada é ${ESCADA.join(' → ')}, e a promoção é sempre entre vizinhos.\n` +
    `  Faça em etapas: ${etapas.join(', depois ')}.`
  );
}

// ------------------------------------------------------------- adaptador CLI

async function principal(): Promise<void> {
  // `node:child_process` só é carregado aqui: o topo do módulo fica puro, e o
  // teste importa a lógica sem puxar API de Node.
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const git = (...args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();

  const comando = process.argv[2] ?? '';
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const finais = tags.filter((t) => lerVersaoFinal(t) !== null);
  const ultimaFinal =
    finais.length > 0
      ? finais.sort((a, b) => {
          const x = lerVersaoFinal(a)!;
          const y = lerVersaoFinal(b)!;
          return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
        })[finais.length - 1]!
      : null;

  const emitir = (chave: string, valor: string): void => {
    console.log(`${chave}=${valor}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${chave}=${valor}\n`);
    }
  };

  if (comando === 'ultima-final') {
    emitir('ultima_final', ultimaFinal ?? '');
    return;
  }

  if (comando === 'proximo-n') {
    const versao = process.argv[3] ?? '';
    const estagio = (process.argv[4] ?? '') as Estagio;
    emitir('versao', versao);
    emitir('n', String(proximoN(tags, versao, estagio)));
    emitir('tag', montarTag(versao, estagio, proximoN(tags, versao, estagio)));
    return;
  }

  if (comando === 'ancora') {
    const versao = process.argv[3] ?? '';
    const sha = process.argv[4] ?? '';
    const shaPorTag: Record<string, string> = {};
    for (const t of tags) {
      try {
        shaPorTag[t] = git('rev-list', '-n1', t);
      } catch {
        // Tag que não resolve fica de fora; `verificarAncora` trata a ausência
        // como verificação impossível — e reprova, nunca aprova.
      }
    }
    const r = verificarAncora(versao, tags, shaPorTag, sha);
    if (!r.ok) {
      console.error(`[version] âncora inválida: ${r.motivo}`);
      process.exit(1);
    }
    console.log(`[version] âncora ok: ${r.tagEsperada} aponta para ${sha.slice(0, 8)}`);
    return;
  }

  console.error(
    'uso: node scripts/ci/version.ts <ultima-final | proximo-n <versao> <estagio> | ancora <versao> <sha>>',
  );
  process.exit(2);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
