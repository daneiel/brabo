import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import { classificar, foraDeImagem, REGRAS_SEM_IMAGEM, type RegraSemImagem } from './diff-toca-imagem.ts';

/**
 * A regra (AT-303): o job `images` só pula build/Trivy/smoke/E2E quando TODO
 * arquivo do diff está fora de imagem, do smoke e do E2E. Qualquer dúvida —
 * diff vazio, diff incalculável, arquivo fora da lista de permitidos — roda
 * tudo.
 */

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

describe('classificar', () => {
  it('pula quando o diff é só documentação, site, manifestos e workflows vizinhos', () => {
    const r = classificar([
      'docs/reference/rulesets.md',
      'website/docusaurus.config.ts',
      'deploy/k8s/base/api/deployment.yaml',
      'scripts/docs/generate.mjs',
      '.github/workflows/docs-check.yml',
      'CHANGELOG.md',
      'CLAUDE.md',
      'design/README.md',
    ]);
    expect(r.rodar).toBe(false);
    expect(r.tocam).toEqual([]);
    expect(r.motivo).toContain('pulados');
  });

  it('roda quando UM arquivo do diff entra em imagem, e nomeia qual', () => {
    const r = classificar(['docs/intro.md', 'apps/api/src/main.ts']);
    expect(r.rodar).toBe(true);
    expect(r.tocam).toEqual(['apps/api/src/main.ts']);
    expect(r.motivo).toContain('1 de 2');
  });

  it('roda com diff vazio e com diff incalculável — na dúvida, roda', () => {
    expect(classificar([]).rodar).toBe(true);
    expect(classificar(['', '  ']).rodar).toBe(true);
    expect(classificar(null).rodar).toBe(true);
    expect(classificar(null).motivo).toContain('não pôde ser calculado');
  });

  it.each([
    ['docs/gates.yml', 'a api o carrega na imagem e o smoke o cobra (RN-070)'],
    ['THIRD_PARTY_NOTICES.md', 'copiado para a imagem do engine'],
    ['.github/workflows/ci.yml', 'é onde os passos do próprio job moram'],
    ['docker-bake.hcl', 'define as cinco imagens'],
    ['.dockerignore', 'decide o contexto de build'],
    ['.trivyignore.yaml', 'muda o veredito do Trivy'],
    ['docker/smoke.sh', 'é o smoke'],
    ['docker/docker-compose.prod.yml', 'é o compose do smoke'],
    ['e2e/testes/autenticacao.spec.ts', 'é o E2E'],
    ['e2e/pnpm-lock.yaml', 'é o lockfile do E2E'],
    ['design/tokens.css', 'é input do build do web'],
    ['apps/engine/priv/prompts/criativo.md', '.md fora da raiz pode ser dado de runtime'],
    ['pnpm-lock.yaml', 'lockfile das imagens Node'],
    ['deploy/outra-coisa.txt', 'só deploy/k8s/ está na lista'],
    ['scripts/ci/version.ts', 'só scripts/docs/ está na lista'],
  ])('roda para %s (%s)', (arquivo) => {
    expect(foraDeImagem(arquivo)).toBe(false);
    expect(classificar([arquivo]).rodar).toBe(true);
  });
});

// --- Contra a árvore real ---------------------------------------------------
//
// A lista de permitidos só é segura se NADA que as imagens, o smoke ou o E2E
// leem casar com ela. Em vez de confiar na lista, o spec lê o que os
// Dockerfiles de produção copiam e o que o `.dockerignore` reinclui, e cobra
// que cada um desses caminhos RODE o job.

/** Todo caminho de origem de `COPY` (sem `--from`) dos Dockerfiles de produção. */
function origensDosDockerfiles(): string[] {
  const origens: string[] = [];
  for (const pasta of readdirSync(`${RAIZ}docker`, { withFileTypes: true })) {
    if (!pasta.isDirectory()) continue;
    let conteudo: string;
    try {
      conteudo = readFileSync(`${RAIZ}docker/${pasta.name}/Dockerfile.prod`, 'utf8');
    } catch {
      continue;
    }
    // Junta continuações de linha (`\` no fim) antes de ler os argumentos.
    for (const linha of conteudo.replace(/\\\n/g, ' ').split('\n')) {
      const m = /^\s*COPY\s+(.*)$/.exec(linha);
      if (m === null || /--from=/.test(m[1] ?? '')) continue;
      const args = (m[1] ?? '').split(/\s+/).filter((a) => a.length > 0 && !a.startsWith('--'));
      // O último argumento é o destino.
      for (const origem of args.slice(0, -1)) origens.push(origem.replace(/\/$/, ''));
    }
  }
  return origens;
}

/** As reinclusões (`!caminho`) do `.dockerignore`: dado de produção dentro de pasta excluída. */
function reinclusoesDoDockerignore(): string[] {
  return readFileSync(`${RAIZ}.dockerignore`, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('!'))
    .map((l) => l.slice(1).trim());
}

/**
 * O `.dockerignore` tira o caminho do contexto de build? Mesma semântica do
 * Docker para o que o arquivo usa: padrão casa o caminho ou uma pasta acima
 * dele, e a última regra que casa (`!` reinclui) vence.
 */
function foraDoContexto(caminho: string): boolean {
  let excluido = false;
  for (const bruta of readFileSync(`${RAIZ}.dockerignore`, 'utf8').split('\n')) {
    const linha = bruta.trim();
    if (linha.length === 0 || linha.startsWith('#')) continue;
    const nega = linha.startsWith('!');
    const padrao = nega ? linha.slice(1) : linha;
    const casa = picomatch(padrao, { dot: true });
    const partes = caminho.split('/');
    const algumPrefixo = partes.some((_, i) => casa(partes.slice(0, i + 1).join('/')));
    if (algumPrefixo) excluido = !nega;
  }
  return excluido;
}

/**
 * Os caminhos que as imagens/smoke/E2E leem e que uma lista de regras
 * classificaria como "fora de imagem" — a lista CERTA devolve vazio. Pasta
 * copiada inteira é testada por um arquivo de exemplo dentro dela, inclusive
 * um `.md`, que é o que uma regra frouxa de `*.md` deixaria passar.
 */
function vazamentos(regras: readonly RegraSemImagem[]): string[] {
  const entradas = [
    ...origensDosDockerfiles(),
    ...reinclusoesDoDockerignore(),
    '.github/workflows/ci.yml',
    'docker-bake.hcl',
    'docker/smoke.sh',
    'docker/docker-compose.prod.yml',
    'e2e/playwright.config.ts',
  ];
  const candidatos = entradas.flatMap((e) => (/\.[a-z]+$/i.test(e) ? [e] : [e, `${e}/x.ts`, `${e}/README.md`]));
  // Exemplo inventado que o `.dockerignore` tira do contexto (o `.md` dentro
  // de `design/`) não é entrada de imagem; os caminhos REAIS ficam sempre.
  return candidatos
    .filter((c) => entradas.includes(c) || !foraDoContexto(c))
    .filter((c) => foraDeImagem(c, regras));
}

describe('contra a árvore real', () => {
  it('lê os Dockerfiles de verdade (senão o cruzamento abaixo seria cego)', () => {
    const origens = origensDosDockerfiles();
    expect(origens).toContain('apps/api');
    expect(origens).toContain('docs/gates.yml');
    expect(origens).toContain('THIRD_PARTY_NOTICES.md');
    expect(origens).toContain('design');
    expect(reinclusoesDoDockerignore()).toContain('docs/gates.yml');
  });

  it('nada que imagem, smoke ou E2E leem casa com a lista de permitidos', () => {
    expect(vazamentos(REGRAS_SEM_IMAGEM)).toEqual([]);
  });

  // Prova por MUTAÇÃO: cada exceção da lista existe por um arquivo que a
  // árvore real carrega. Tirá-la faz o cruzamento acima ACUSAR esse arquivo —
  // se não acusasse, o cruzamento seria o instrumento que não mede.
  it('mutação: docs/ inteira sem a exceção do gates.yml vaza o registro de gates', () => {
    const mutadas = REGRAS_SEM_IMAGEM.map((r) =>
      r.descricao.startsWith('docs/') ? { ...r, casa: (a: string) => a.startsWith('docs/') } : r,
    );
    expect(vazamentos(mutadas)).toContain('docs/gates.yml');
  });

  it('mutação: *.md em qualquer lugar vaza o aviso de terceiros e o .md de dentro das apps', () => {
    const mutadas = [...REGRAS_SEM_IMAGEM, { descricao: '*.md', casa: (a: string) => a.endsWith('.md') }];
    const vazou = vazamentos(mutadas);
    expect(vazou).toContain('THIRD_PARTY_NOTICES.md');
    expect(vazou).toContain('apps/engine/priv/README.md');
  });

  it('mutação: .github/ inteira vaza o ci.yml', () => {
    const mutadas = REGRAS_SEM_IMAGEM.map((r) =>
      r.descricao.startsWith('.github/') ? { ...r, casa: (a: string) => a.startsWith('.github/') } : r,
    );
    expect(vazamentos(mutadas)).toContain('.github/workflows/ci.yml');
  });

  it('mutação: design/ inteira vaza os tokens que o build do web importa', () => {
    const mutadas = [...REGRAS_SEM_IMAGEM, { descricao: 'design/', casa: (a: string) => a.startsWith('design/') }];
    expect(vazamentos(mutadas)).toContain('design/x.ts');
  });
});

describe('o ci.yml usa a classificação', () => {
  const ci = readFileSync(`${RAIZ}.github/workflows/ci.yml`, 'utf8');

  it('chama o script no job de imagens e condiciona os passos pesados à saída', () => {
    expect(ci).toContain('node scripts/ci/diff-toca-imagem.ts');
    const condicionados = ci.match(/if: steps\.diff\.outputs\.rodar == 'true'/g) ?? [];
    // bake, non-root, trivy (instalar, base, scan), broker, smoke, pnpm, node,
    // deps do e2e, cache do navegador, navegador, e2e — o número exato é o
    // que o arquivo tem; o piso impede que um passo pesado perca o `if:`
    // e o spec continue verde.
    expect(condicionados.length).toBeGreaterThanOrEqual(10);
  });

  it('não usa paths: no gatilho nem if: no job de imagens (check exigido colaria o veredito)', () => {
    const gatilho = ci.slice(0, ci.indexOf('\njobs:'));
    expect(gatilho).not.toMatch(/^\s*paths(-ignore)?:/m);
    const job = ci.slice(ci.indexOf('\n  images:'));
    const cabecalho = job.slice(0, job.indexOf('\n    steps:'));
    expect(cabecalho).not.toMatch(/^\s{4}if:/m);
  });
});
