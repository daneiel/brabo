/**
 * Números em PROSA que o repositório afirma sobre si mesmo, cada um DERIVADO
 * do artefato que ele conta (AT-123).
 *
 * É a irmã de `verificarContagensEmProsa` e de
 * `verificarFrasesAncoradasNoCodigo` (`generate.mjs`), com a mesma régua —
 * `gerar > verificar > lembrar` (ADR 0029) — e existe como módulo à parte por
 * um motivo só: aqui as FONTES são muitas e cada uma é um pequeno extrator,
 * e extrator que não se testa por mutação é o check que fica verde para
 * sempre. `contagens-do-codigo.spec.ts` prova, para cada fonte, que o
 * número muda quando o artefato muda (DESATUAL) e que o check reprova quando
 * a frase ou a fonte some (CEGO).
 *
 * Três estados, nunca dois:
 *   - `ok`        a frase diz o que o artefato conta;
 *   - `DESATUAL`  a frase diz outro número;
 *   - `CEGO`      a frase não foi achada (o padrão parou de casar) OU a fonte
 *                 não pôde ser contada. Um check cego fica verde dizendo que
 *                 conferiu o que não olhou — por isso reprova.
 *
 * A comparação ignora CAIXA (o `CLAUDE.md` escreve "SEIS" e "CINCO" para dar
 * ênfase), e a FORMA do número é a da frase: por extenso em pt-BR (masculino
 * ou feminino), por extenso em inglês, ou algarismo. Passar do fim da tabela
 * por extenso cai no algarismo — que a frase então não vai dizer, e reprova
 * como DESATUAL em vez de passar calado.
 */

const EN = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
  'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven',
  'twenty-eight', 'twenty-nine', 'thirty',
];
const PT = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove', 'vinte', 'vinte e um', 'vinte e dois', 'vinte e três',
  'vinte e quatro', 'vinte e cinco', 'vinte e seis', 'vinte e sete',
  'vinte e oito', 'vinte e nove', 'trinta',
];
const FEMININO = { um: 'uma', dois: 'duas', 'vinte e um': 'vinte e uma', 'vinte e dois': 'vinte e duas' };

/** O número na forma em que a frase o escreve. Fora da tabela, o algarismo. */
export function naForma(n, forma) {
  if (typeof n !== 'number') return String(n);
  if (forma === 'digito') return String(n);
  if (forma === 'en') return EN[n] ?? String(n);
  const pt = PT[n];
  if (pt === undefined) return String(n);
  return forma === 'pt_f' ? (FEMININO[pt] ?? pt) : pt;
}

// ------------------------------------------------------------------ extratores
//
// Cada um recebe o CONTEXTO (`ler`, `listar`, `rodarNode`, `externas`) e
// devolve o número — ou `null` quando não achou o que contar, que vira CEGO.

/** O corpo entre `abre` e o primeiro `fecha` depois dele, ou `null`. */
function trecho(texto, abre, fecha) {
  const i = texto.indexOf(abre);
  if (i === -1) return null;
  const f = texto.indexOf(fecha, i + abre.length);
  return f === -1 ? null : texto.slice(i + abre.length, f);
}

/** As chaves do bloco `overrides:` de um `pnpm-workspace.yaml`. */
function contarOverrides(texto) {
  const linhas = texto.split('\n');
  const i = linhas.findIndex((l) => l === 'overrides:');
  if (i === -1) return null;
  let n = 0;
  for (const linha of linhas.slice(i + 1)) {
    if (/^\S/.test(linha)) break; // próxima chave de topo
    if (/^ {2}[^\s#]/.test(linha)) n++;
  }
  return n;
}

export const FONTES = {
  overridesRaiz: {
    descricao: '`overrides` em `pnpm-workspace.yaml`',
    contar: ({ ler }) => contarOverrides(ler('pnpm-workspace.yaml')),
  },
  overridesWebsite: {
    descricao: '`overrides` em `website/pnpm-workspace.yaml`',
    contar: ({ ler }) => contarOverrides(ler('website/pnpm-workspace.yaml')),
  },
  goldenSetRagCasos: {
    descricao: '`CASOS` em `apps/api/scripts/seed-golden-set-rag.ts`',
    contar: ({ ler }) => {
      const corpo = trecho(ler('apps/api/scripts/seed-golden-set-rag.ts'), 'const CASOS: CasoRag[] = [', '\n];');
      if (corpo === null) return null;
      const n = [...corpo.matchAll(/^\s+expectedPath:/gm)].length;
      return n === 0 ? null : n;
    },
  },
  goldenSetRagCorpus: {
    descricao: '`ARQUIVOS_CURADOS` em `apps/api/scripts/seed-golden-set-rag.ts`',
    contar: ({ ler }) => {
      const corpo = trecho(ler('apps/api/scripts/seed-golden-set-rag.ts'), 'const ARQUIVOS_CURADOS = [', '] as const;');
      if (corpo === null) return null;
      const n = [...corpo.matchAll(/'[^']+'/g)].length;
      return n === 0 ? null : n;
    },
  },
  goldenSetRagPiso: {
    descricao: 'o piso em `apps/engine/test/fixtures/golden_set_rag/floor.json`',
    contar: ({ ler }) => {
      let json;
      try {
        json = JSON.parse(ler('apps/engine/test/fixtures/golden_set_rag/floor.json'));
      } catch {
        return null;
      }
      const modelos = Object.entries(json).filter(([k]) => !k.startsWith('_'));
      if (modelos.length !== 1) return null; // dois modelos: a frase precisaria dizer qual
      const [, { passRate, of }] = modelos[0];
      return Number.isInteger(passRate) && Number.isInteger(of) ? `${passRate}/${of}` : null;
    },
  },
  imagensDeTerceiro: {
    descricao: 'o total de `node scripts/ci/imagens-pinadas.ts`',
    contar: ({ rodarNode }) => {
      const saida = rodarNode('scripts/ci/imagens-pinadas.ts');
      const m = saida === null ? null : /(\d+) imagens de terceiro/.exec(saida);
      return m === null ? null : Number(m[1]);
    },
  },
  imagensPublicadas: {
    descricao: '`ALVOS` em `scripts/ci/images-manifest.ts`',
    contar: ({ ler }) => {
      const m = /export const ALVOS = \[([^\]]+)\] as const;/.exec(ler('scripts/ci/images-manifest.ts'));
      return m === null ? null : [...m[1].matchAll(/'[a-z-]+'/g)].length;
    },
  },
  imagensNonRootNoSmoke: {
    descricao: 'o laço non-root de `docker/smoke.sh`',
    contar: ({ ler }) => {
      const m = /non-root'\n\s*for svc in ([^;]+); do/.exec(ler('docker/smoke.sh'));
      return m === null ? null : m[1].trim().split(/\s+/).length;
    },
  },
  operacoesDoGit: {
    descricao: 'os métodos de `GitProviderContract` em `packages/shared/src/index.ts`',
    contar: ({ ler }) => {
      const corpo = trecho(ler('packages/shared/src/index.ts'), 'export interface GitProviderContract {', '\n}');
      if (corpo === null) return null;
      const n = [...corpo.matchAll(/^ {2}[a-zA-Z]+\(/gm)].length;
      return n === 0 ? null : n;
    },
  },
  operacoesDoDocker: {
    descricao: 'os métodos de `DockerPort` em `packages/docker-port/src/docker-port.ts`',
    contar: ({ ler }) => {
      const corpo = trecho(ler('packages/docker-port/src/docker-port.ts'), 'export abstract class DockerPort {', '\n}');
      if (corpo === null) return null;
      const n = [...corpo.matchAll(/^\s+abstract [a-zA-Z]+\(/gm)].length;
      return n === 0 ? null : n;
    },
  },
  abasDoProjeto: {
    descricao: 'as entradas de `REGISTRO` em `apps/web/src/routes/project-tabs.ts`',
    contar: ({ ler }) => {
      const corpo = trecho(ler('apps/web/src/routes/project-tabs.ts'), 'const REGISTRO = [', '] as const');
      if (corpo === null) return null;
      const n = [...corpo.matchAll(/^ {4}key: '/gm)].length;
      return n === 0 ? null : n;
    },
  },
  servicosDoComposeDeDev: {
    // Conta os serviços que sobem POR PADRÃO — os sem `profiles:`, que são os
    // que `pnpm dev`/`up --wait` levanta; os do profile `local-llm` são
    // opt-in — e a frase diz que TODOS têm healthcheck. Serviço padrão novo
    // sem healthcheck muda o esperado para uma frase que a prosa não tem, e
    // reprova: é essa a regra que ela anuncia.
    descricao: 'os serviços sem `profiles:` de `docker/docker-compose.yml`',
    contar: ({ ler }) => {
      const texto = ler('docker/docker-compose.yml');
      const m = /^services:\n([\s\S]*?)^\S/m.exec(texto);
      if (m === null) return null;
      const blocos = m[1].split(/^ {2}(?=[a-z0-9-]+:\s*$)/m).slice(1);
      const padrao = blocos.filter((b) => !/^ {4}profiles:/m.test(b));
      if (padrao.length === 0) return null;
      const semHealthcheck = padrao.filter((b) => !/^ {4}healthcheck:/m.test(b)).length;
      return semHealthcheck === 0
        ? padrao.length
        : `${padrao.length} serviços, ${semHealthcheck} sem healthcheck`;
    },
  },
  tiposDeAcao: {
    descricao: '`ACTION_TYPES` em `apps/api/src/domain/actions/decide.ts`',
    contar: ({ ler }) => {
      const m = /export const ACTION_TYPES: readonly ActionType\[\] = \[([\s\S]*?)\];/.exec(
        ler('apps/api/src/domain/actions/decide.ts'),
      );
      return m === null ? null : [...m[1].matchAll(/'[a-z_]+'/g)].length;
    },
  },
  estadosDeAcao: {
    descricao: "o enum `action_status` em `apps/api/src/db/schema/actions.ts`",
    contar: ({ ler }) => {
      const m = /pgEnum\('action_status', \[([\s\S]*?)\]\)/.exec(ler('apps/api/src/db/schema/actions.ts'));
      return m === null ? null : [...m[1].matchAll(/'[a-z_]+'/g)].length;
    },
  },
  tabelasDoBanco: {
    descricao: 'os `pgTable(` em `apps/api/src/db/schema/*.ts`',
    contar: ({ ler, listar }) => {
      const n = listar('apps/api/src/db/schema/*.ts').reduce(
        (soma, f) => soma + [...ler(f).matchAll(/\bpgTable\(/g)].length,
        0,
      );
      return n === 0 ? null : n;
    },
  },
  schemasDeArtefato: {
    descricao: '`contarSchemasDeArtefato` (`generate.mjs`)',
    contar: ({ externas }) => externas?.schemas ?? null,
  },
  providersDeLlm: {
    descricao: '`descobrirProviders` (`generate.mjs`)',
    contar: ({ externas }) => externas?.providers ?? null,
  },
};

// ------------------------------------------------------------------ aferições
//
// `padrao` captura o NÚMERO no grupo 1. `\s+` entre palavras onde a prosa
// quebra linha. Uma entrada por LUGAR: a mesma contagem dita em dois
// arquivos são duas frases que envelhecem separadas.

export const AFERICOES = [
  // overrides — "já são catorze na raiz e treze no website"
  { arquivo: 'CLAUDE.md', padrao: /já são (\S+) na raiz e \S+ no website/, fonte: 'overridesRaiz', forma: 'pt_m' },
  { arquivo: 'CLAUDE.md', padrao: /já são \S+ na raiz e (\S+) no website/, fonte: 'overridesWebsite', forma: 'pt_m' },

  // golden-set do RAG
  { arquivo: 'CLAUDE.md', padrao: /um corpo de (\S+) perguntas medindo/, fonte: 'goldenSetRagCasos', forma: 'digito' },
  { arquivo: 'docs/explanation/gates.md', padrao: /\((\S+) questions composed from real RNs/, fonte: 'goldenSetRagCasos', forma: 'digito' },
  { arquivo: 'CLAUDE.md', padrao: /corpus CURADO \((\S+) arquivos, não os/, fonte: 'goldenSetRagCorpus', forma: 'digito' },
  { arquivo: 'CLAUDE.md', padrao: /corpus CURADO \((\S+) arquivos\), não os/, fonte: 'goldenSetRagCorpus', forma: 'digito' },
  { arquivo: 'CLAUDE.md', padrao: /medido de verdade \((\d+\/\d+),/, fonte: 'goldenSetRagPiso', forma: 'digito' },

  // imagens de terceiro presas por digest
  { arquivo: 'docs/explanation/cadeia-de-suprimentos-do-ci.md', padrao: /all (\S+) third-party references/, fonte: 'imagensDeTerceiro', forma: 'digito' },

  // imagens que o produto publica / que o smoke confere
  { arquivo: 'CLAUDE.md', padrao: /As (\S+) imagens de\s+produção são PUBLICADAS/, fonte: 'imagensPublicadas', forma: 'pt_f' },
  { arquivo: 'README.md', padrao: /build das (\S+) imagens com/, fonte: 'imagensPublicadas', forma: 'pt_f' },
  { arquivo: 'README.md', padrao: /confere que as (\S+) imagens rodam non-root/, fonte: 'imagensNonRootNoSmoke', forma: 'pt_f' },

  // contrato de git
  { arquivo: 'README.md', padrao: /o contrato de (\S+) operações e as capabilities/, fonte: 'operacoesDoGit', forma: 'pt_f' },
  { arquivo: 'CONTRIBUTING.md', padrao: /implementar as (\S+) operações, declarar/, fonte: 'operacoesDoGit', forma: 'pt_f' },
  { arquivo: 'docs/reference/git-providers.md', padrao: /\*\*(\S+) operations\*\* —/, fonte: 'operacoesDoGit', forma: 'en' },
  { arquivo: 'docs/reference/git-providers.md', padrao: /implementing all (\S+) operations, honestly/, fonte: 'operacoesDoGit', forma: 'en' },
  { arquivo: 'docs/architecture.md', padrao: /`GitProviderContract` — (\S+) operations, \*\*types/, fonte: 'operacoesDoGit', forma: 'en' },

  // porta de Docker
  { arquivo: 'CLAUDE.md', padrao: /PORTA de\s+(\S+) operações \(`packages\/docker-port`/, fonte: 'operacoesDoDocker', forma: 'pt_f' },
  { arquivo: 'CLAUDE.md', padrao: /das (\S+) operações da `DockerPort`/, fonte: 'operacoesDoDocker', forma: 'pt_f' },
  { arquivo: 'docs/architecture.md', padrao: /the Docker PORT \((\S+) operations\)/, fonte: 'operacoesDoDocker', forma: 'en' },

  // web, compose, ações, banco
  { arquivo: 'README.md', padrao: /— (\S+) abas, derivadas de um registro único/, fonte: 'abasDoProjeto', forma: 'pt_f' },
  { arquivo: 'CLAUDE.md', padrao: /Os (\S+) serviços do compose de DEV têm healthcheck/, fonte: 'servicosDoComposeDeDev', forma: 'pt_m' },
  { arquivo: 'docs/glossary.md', padrao: /executes directly\. (\S+) types\./, fonte: 'tiposDeAcao', forma: 'en' },
  { arquivo: 'docs/glossary.md', padrao: /executes directly\. \S+ types\. (\S+) states/, fonte: 'estadosDeAcao', forma: 'en' },
  { arquivo: 'docs/architecture.md', padrao: /^(\d+) tables in total\./m, fonte: 'tabelasDoBanco', forma: 'digito' },

  // artefatos e providers
  { arquivo: 'README.md', padrao: /os (\S+) schemas e quem pode emitir/, fonte: 'schemasDeArtefato', forma: 'pt_m' },
  { arquivo: 'docs/reference/artifacts.md', padrao: /^description: The (\S+) artifact schemas/m, fonte: 'schemasDeArtefato', forma: 'en' },
  { arquivo: 'CLAUDE.md', padrao: /; (\d+) providers \(ADR 0043\)/, fonte: 'providersDeLlm', forma: 'digito' },
];

/**
 * Confere cada aferição contra a fonte dela. `ctx.ler(rel)` lê um arquivo do
 * repositório; `ctx.listar(glob)` lista os versionados; `ctx.rodarNode(rel)`
 * devolve o stdout de um script (ou `null` se ele falhou); `ctx.externas`
 * traz as contagens que `generate.mjs` já tem.
 */
export function aferirContagens(ctx, afericoes = AFERICOES, fontes = FONTES) {
  const cache = new Map();
  const contar = (nome) => {
    if (!cache.has(nome)) {
      const fonte = fontes[nome];
      let valor = null;
      try {
        valor = fonte ? fonte.contar(ctx) : null;
      } catch {
        valor = null;
      }
      cache.set(nome, valor);
    }
    return cache.get(nome);
  };

  return afericoes.map(({ arquivo, padrao, fonte, forma }) => {
    const descricao = fontes[fonte]?.descricao ?? fonte;
    const valor = contar(fonte);
    if (valor === null || valor === undefined) {
      return { arquivo, estado: 'CEGO', motivo: `a fonte não pôde ser contada: ${descricao}` };
    }
    let texto;
    try {
      texto = ctx.ler(arquivo);
    } catch {
      return { arquivo, estado: 'CEGO', motivo: 'o arquivo não existe' };
    }
    const achado = padrao.exec(texto);
    if (achado === null) {
      return { arquivo, estado: 'CEGO', motivo: `não achei a frase (${padrao})` };
    }
    const esperado = naForma(valor, forma);
    if (achado[1].toLowerCase() !== esperado.toLowerCase()) {
      return { arquivo, estado: 'DESATUAL', diz: achado[1], esperado, descricao };
    }
    return { arquivo, estado: 'ok', esperado, descricao };
  });
}
