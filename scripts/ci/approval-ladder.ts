/**
 * approval-ladder — exige as aprovações certas para cada degrau da escada.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * O pr-police diz se o PR está no LUGAR certo; este diz se ele tem as
 * APROVAÇÕES certas. Os dois são checks required e não conversam entre si de
 * propósito: nenhum lê a label do outro, senão quem pode editar label mudaria o
 * regime de aprovação.
 *
 * Dois modos, escolhidos pela variável de repositório APPROVAL_MODE. Os dois
 * são implementados e testados; trocar de um para o outro é só mudar
 * variáveis, sem tocar em código — há teste provando exatamente isso.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { ESCADA, type Permanente } from './pr-police.ts';

// ---------------------------------------------------------------- a política

export const MODOS = ['solo', 'community'] as const;
export type Modo = (typeof MODOS)[number];

export const PAPEIS = ['devs', 'qualidade', 'po', 'gestao'] as const;
export type Papel = (typeof PAPEIS)[number];

export interface Exigencia {
  papel: Papel;
  quantidade: number;
}

/**
 * A escada de aprovação do modo `community`, por DESTINO. Quanto mais alto o
 * degrau, mais gente e mais papéis distintos.
 */
export const ESCADA_DE_APROVACAO: Record<Permanente, Exigencia[]> = {
  dev: [{ papel: 'devs', quantidade: 1 }],
  qa: [{ papel: 'devs', quantidade: 2 }],
  rc: [
    { papel: 'qualidade', quantidade: 1 },
    { papel: 'devs', quantidade: 1 },
  ],
  main: [
    { papel: 'po', quantidade: 1 },
    { papel: 'gestao', quantidade: 1 },
  ],
};

/**
 * Degraus em que a exigência de PESSOAS DISTINTAS vale. Em `dev` e `qa` a
 * distinção é automática (cada pessoa tem um review só), mas em `rc` e `main`
 * as vagas são de papéis diferentes — e quem está em duas listas poderia
 * preencher as duas sozinho se ninguém checasse.
 */
export const DESTINOS_COM_PESSOAS_DISTINTAS: readonly Permanente[] = ['rc', 'main'];

export const NOME_DA_VARIAVEL_POR_PAPEL: Record<Papel, string> = {
  devs: 'APROVADORES_DEVS',
  qualidade: 'APROVADORES_QUALIDADE',
  po: 'APROVADORES_PO',
  gestao: 'APROVADORES_GESTAO',
};

// ------------------------------------------------------------------- tipos

export interface Review {
  autor: string;
  /** `APPROVED` | `CHANGES_REQUESTED` | `COMMENTED` | `DISMISSED` */
  estado: string;
  /** O commit que o review examinou. */
  commitId: string;
}

export interface EntradaEscada {
  modo: Modo;
  destino: string;
  autorDoPr: string;
  /** O head do PR agora — reviews em outro sha estão obsoletos. */
  shaDoUltimoCommit: string;
  reviews: Review[];
  /** Modo solo. */
  owner?: string;
  /** Modo community: handles por papel. */
  aprovadores?: Partial<Record<Papel, string[]>>;
}

/** O que o emparelhamento produz: sempre um papel de verdade. */
export interface VagaDePapel {
  papel: Papel;
  quem: string;
}

export interface VagaPreenchida {
  /** `owner` é o modo solo, onde não existem papéis — só o mantenedor. */
  papel: Papel | 'owner';
  quem: string;
}

export interface VereditoDeEscada {
  ok: boolean;
  modo: Modo;
  /** Quem aprovou e em que papel — vazio no solo, onde não há papéis. */
  preenchidas: VagaPreenchida[];
  /** Aprovações válidas que não couberam em vaga nenhuma. */
  aprovadoresSemVaga: string[];
  /** O que ainda falta, em português. */
  faltando: string[];
  avisos: string[];
  /** Ninguém precisou aprovar — o PR é do próprio owner, no modo solo. */
  dispensadoPorAutoria: boolean;
}

// ---------------------------------------------------- reviews que contam

/**
 * Aprovações válidas: só `APPROVED`, só no último commit, e nunca do autor.
 *
 * Três sutilezas do GitHub que mudam o resultado:
 *
 * - Review em commit anterior é OBSOLETO. Push novo invalida o que foi
 *   aprovado, porque o que foi aprovado não é mais o que vai ser mergeado.
 * - `COMMENTED` NÃO derruba uma aprovação — comentar depois de aprovar não
 *   desaprova. Por isso ele é ignorado em vez de contar como "último estado".
 * - Vale o ÚLTIMO estado decisivo de cada pessoa. Quem aprovou e depois pediu
 *   mudanças no mesmo commit não aprovou.
 */
export function aprovadoresValidos(entrada: EntradaEscada): string[] {
  const ultimoPorPessoa = new Map<string, string>();

  for (const review of entrada.reviews) {
    if (review.commitId !== entrada.shaDoUltimoCommit) continue;
    if (review.autor === entrada.autorDoPr) continue;
    if (review.estado === 'COMMENTED') continue;
    ultimoPorPessoa.set(review.autor, review.estado);
  }

  const validos: string[] = [];
  for (const [pessoa, estado] of ultimoPorPessoa) {
    if (estado === 'APPROVED') validos.push(pessoa);
  }
  return validos.sort();
}

// ------------------------------------------------- emparelhamento das vagas

/**
 * As exigências viram VAGAS individuais (`qa` → duas vagas de devs) e o
 * problema passa a ser: existe atribuição de pessoas DISTINTAS que preencha
 * todas?
 *
 * Contar por papel isoladamente daria falso positivo justamente no caso que a
 * regra existe para pegar: em `rc`, alguém que está nas listas de `qualidade` E
 * de `devs` satisfaria as duas contagens sozinho.
 *
 * Backtracking exato, não heurística gulosa — com no máximo 4 vagas o custo é
 * irrelevante, e o guloso erraria quando a primeira vaga consome a única
 * pessoa que poderia preencher a segunda.
 */
export function emparelhar(
  vagas: Papel[],
  candidatos: string[],
  membroDe: (pessoa: string, papel: Papel) => boolean,
): VagaDePapel[] {
  let melhor: VagaDePapel[] = [];
  const atual: VagaDePapel[] = [];
  const usados = new Set<string>();

  // Devolve o emparelhamento MÁXIMO, não "conseguiu ou não". A diferença
  // importa na mensagem: com o parcial em mãos dá para dizer "falta 1 de
  // `devs`" em vez de só "não fechou".
  const tentar = (i: number): void => {
    if (atual.length > melhor.length) melhor = [...atual];
    if (i === vagas.length || melhor.length === vagas.length) return;

    const papel = vagas[i]!;
    for (const pessoa of candidatos) {
      if (usados.has(pessoa) || !membroDe(pessoa, papel)) continue;

      usados.add(pessoa);
      atual.push({ papel, quem: pessoa });
      tentar(i + 1);
      atual.pop();
      usados.delete(pessoa);
    }
    // Deixar a vaga vazia e seguir — é o que permite achar o máximo quando
    // uma vaga é impossível mas as outras não.
    tentar(i + 1);
  };

  tentar(0);
  return melhor;
}

// ------------------------------------------------------------ a avaliação

function ehPermanente(nome: string): nome is Permanente {
  return (ESCADA as readonly string[]).includes(nome);
}

export function avaliarEscada(entrada: EntradaEscada): VereditoDeEscada {
  const base = {
    modo: entrada.modo,
    preenchidas: [] as VagaPreenchida[],
    aprovadoresSemVaga: [] as string[],
    avisos: [] as string[],
    dispensadoPorAutoria: false,
  };

  if (!ehPermanente(entrada.destino)) {
    return {
      ...base,
      ok: false,
      faltando: [
        `destino \`${entrada.destino}\` não é uma branch permanente — ` +
          `a escada só se aplica a ${ESCADA.map((p) => `\`${p}\``).join(', ')}.`,
      ],
    };
  }

  const validos = aprovadoresValidos(entrada);

  // ------------------------------------------------------------ modo solo
  if (entrada.modo === 'solo') {
    const owner = entrada.owner?.trim();

    if (!owner) {
      return {
        ...base,
        ok: false,
        faltando: [
          'a variável de repositório `OWNER_HANDLE` não está definida — ' +
            'sem ela não há como saber de quem é a aprovação exigida.',
        ],
      };
    }

    // O GitHub não deixa ninguém aprovar o próprio PR. Num projeto de um
    // mantenedor, exigir isso produziria um check eternamente vermelho — o
    // merge manual do owner é a aprovação.
    if (entrada.autorDoPr === owner) {
      return {
        ...base,
        ok: true,
        dispensadoPorAutoria: true,
        faltando: [],
        avisos: [
          `PR de autoria do owner (\`${owner}\`): passa sem review. ` +
            'O merge manual dele é a aprovação.',
        ],
      };
    }

    const aprovouOOwner = validos.includes(owner);
    return {
      ...base,
      ok: aprovouOOwner,
      preenchidas: aprovouOOwner ? [{ papel: 'owner', quem: owner }] : [],
      aprovadoresSemVaga: validos.filter((p) => p !== owner),
      faltando: aprovouOOwner
        ? []
        : [`aguardando aprovação do owner (\`${owner}\`)`],
      avisos: ['exigência de pessoas distintas SUSPENSA no modo solo'],
    };
  }

  // ------------------------------------------------------- modo community
  const exigencias = ESCADA_DE_APROVACAO[entrada.destino];
  const listas = entrada.aprovadores ?? {};

  const papeisVazios = exigencias
    .map((e) => e.papel)
    .filter((papel) => (listas[papel] ?? []).length === 0);

  if (papeisVazios.length > 0) {
    return {
      ...base,
      ok: false,
      faltando: papeisVazios.map(
        (papel) =>
          `a lista de aprovadores do papel \`${papel}\` está vazia ` +
          `(variável \`${NOME_DA_VARIAVEL_POR_PAPEL[papel]}\`) — ` +
          `nenhuma aprovação para \`${entrada.destino}\` pode ser satisfeita.`,
      ),
    };
  }

  const membroDe = (pessoa: string, papel: Papel): boolean =>
    (listas[papel] ?? []).includes(pessoa);

  const vagas: Papel[] = exigencias.flatMap((e) =>
    Array.from({ length: e.quantidade }, () => e.papel),
  );

  const avisos: string[] = [];
  if (DESTINOS_COM_PESSOAS_DISTINTAS.includes(entrada.destino)) {
    avisos.push(`\`${entrada.destino}\` exige pessoas distintas em cada papel`);
  }

  // O emparelhamento é sempre por pessoas distintas: cada pessoa tem um review
  // só, e ocupar duas vagas seria justamente o que a regra impede. Em `dev` e
  // `qa` isso é automático (papel único); em `rc` e `main` é a regra em si.
  const atribuicao = emparelhar(vagas, validos, membroDe);
  const usados = new Set(atribuicao.map((v) => v.quem));

  if (atribuicao.length === vagas.length) {
    return {
      ...base,
      ok: true,
      preenchidas: atribuicao,
      aprovadoresSemVaga: validos.filter((p) => !usados.has(p)),
      faltando: [],
      avisos,
    };
  }

  // Não fechou. Dizer O QUE falta, e distinguir "ninguém desse papel aprovou"
  // de "a mesma pessoa não pode ocupar as duas vagas".
  const faltando: string[] = [];
  const preenchidasPorPapel = new Map<Papel, number>();
  for (const v of atribuicao) {
    preenchidasPorPapel.set(v.papel, (preenchidasPorPapel.get(v.papel) ?? 0) + 1);
  }

  for (const e of exigencias) {
    const tem = validos.filter((p) => membroDe(p, e.papel)).length;
    const jaPreenchidas = preenchidasPorPapel.get(e.papel) ?? 0;
    const restam = e.quantidade - jaPreenchidas;
    if (restam <= 0) continue;

    if (tem === 0) {
      faltando.push(
        `${restam} aprovação de \`${e.papel}\` — ninguém dessa lista aprovou ainda`,
      );
    } else if (tem < e.quantidade) {
      faltando.push(
        `${restam} aprovação de \`${e.papel}\` — ${tem} de ${e.quantidade} até agora`,
      );
    } else {
      faltando.push(
        `${restam} aprovação de \`${e.papel}\` de uma pessoa DIFERENTE — ` +
          'quem aprovou já está ocupando outra vaga',
      );
    }
  }

  return {
    ...base,
    ok: false,
    preenchidas: atribuicao,
    aprovadoresSemVaga: validos.filter((p) => !usados.has(p)),
    faltando,
    avisos,
  };
}

// -------------------------------------------------------------- renderização

export function formatarEscada(
  entrada: EntradaEscada,
  veredito: VereditoDeEscada,
): string {
  const l: string[] = [];
  l.push(`approval-ladder: → ${entrada.destino}   modo: ${veredito.modo}`);
  l.push('');

  if (veredito.dispensadoPorAutoria) {
    l.push('  ✓ APROVADO — PR de autoria do owner, dispensado de review.');
    l.push('');
    l.push('    O GitHub não permite aprovar o próprio PR. Num projeto de um');
    l.push('    mantenedor, o merge manual do owner É a aprovação.');
    return l.join('\n');
  }

  if (veredito.preenchidas.length > 0) {
    l.push('  Aprovações que contam:');
    for (const v of veredito.preenchidas) {
      l.push(`    ✓ ${v.quem}  (papel: ${v.papel})`);
    }
    l.push('');
  }

  if (veredito.aprovadoresSemVaga.length > 0) {
    l.push(
      `  Aprovaram, mas não preenchem vaga exigida aqui: ${veredito.aprovadoresSemVaga.join(', ')}`,
    );
    l.push('');
  }

  if (veredito.ok) {
    l.push('  ✓ APROVADO — a escada deste degrau está satisfeita.');
  } else {
    l.push('  ✗ AGUARDANDO APROVAÇÃO');
    for (const f of veredito.faltando) l.push(`    · ${f}`);
  }

  if (veredito.avisos.length > 0) {
    l.push('');
    for (const a of veredito.avisos) l.push(`  ⚠ ${a}`);
  }

  l.push('');
  l.push('  A escada inteira: docs/explanation/branching-policy.md');
  return l.join('\n');
}

// ------------------------------------------------------------- adaptador CLI

function listaDaVariavel(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const destino = process.env.PR_BASE_REF ?? '';
  const autorDoPr = process.env.PR_AUTOR ?? '';
  const shaDoUltimoCommit = process.env.PR_HEAD_SHA ?? '';
  const numero = process.env.PR_NUMERO ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';

  if (!destino || !numero || !repo) {
    console.error('[approval-ladder] PR_BASE_REF, PR_NUMERO e GITHUB_REPOSITORY são obrigatórios.');
    process.exit(2);
  }

  const modoBruto = (process.env.APPROVAL_MODE ?? 'solo').trim();
  if (!(MODOS as readonly string[]).includes(modoBruto)) {
    console.error(
      `[approval-ladder] APPROVAL_MODE inválido: "${modoBruto}". ` +
        `Os valores são: ${MODOS.join(', ')}.`,
    );
    process.exit(2);
  }
  const modo = modoBruto as Modo;

  // Uma página de reviews basta em qualquer PR humano; `--paginate` cobre o
  // resto sem custo.
  const bruto = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${repo}/pulls/${numero}/reviews`,
      '--jq',
      '.[] | {autor: .user.login, estado: .state, commitId: .commit_id}',
    ],
    { encoding: 'utf8' },
  );

  const reviews: Review[] = bruto
    .split('\n')
    .filter(Boolean)
    .map((linha) => JSON.parse(linha) as Review);

  const entrada: EntradaEscada = {
    modo,
    destino,
    autorDoPr,
    shaDoUltimoCommit,
    reviews,
    owner: process.env.OWNER_HANDLE,
    aprovadores: {
      devs: listaDaVariavel(process.env.APROVADORES_DEVS),
      qualidade: listaDaVariavel(process.env.APROVADORES_QUALIDADE),
      po: listaDaVariavel(process.env.APROVADORES_PO),
      gestao: listaDaVariavel(process.env.APROVADORES_GESTAO),
    },
  };

  const veredito = avaliarEscada(entrada);
  const saida = formatarEscada(entrada, veredito);
  console.log(saida);

  if (!veredito.ok) {
    console.log(`::error title=approval-ladder::${veredito.faltando.join(' · ')}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### approval-ladder\n\n\`\`\`\n${saida}\n\`\`\`\n`,
    );
  }

  process.exit(veredito.ok ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
