import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A página raiz é gerada, então o que se testa é a GERAÇÃO: quais degraus ela
// oferece, o que faz quando não há nenhum, e a guarda do 404 que impede o
// redirecionamento de virar laço.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'scripts/docs/landing.mjs');

/**
 * Gera a raiz num repositório git PRÓPRIO, com as tags que o teste declara.
 *
 * O gerador lê a versão de cada degrau com `git tag` no diretório corrente.
 * Testar isso contra o repositório de verdade acopla o teste ao estado do
 * clone: o checkout do CI não traz tags, e a primeira versão deste arquivo
 * passava na minha máquina e reprovava lá. Um repositório descartável com
 * tags conhecidas torna a asserção determinística — e, de quebra, passa a
 * PROVAR a leitura de tag em vez de só observá-la.
 */
function gerar(
  degraus: string[],
  tags: string[] = [],
): { indice: string; erro: string; destino: string } {
  const repo = mkdtempSync(path.join(tmpdir(), 'brabo-landing-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: repo,
      stdio: 'pipe',
    });

  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  for (const t of tags) git('tag', t);

  const destino = path.join(repo, 'publicacao');
  mkdirSync(destino, { recursive: true });
  for (const d of degraus) {
    mkdirSync(path.join(destino, d), { recursive: true });
    writeFileSync(path.join(destino, d, 'index.html'), '<html></html>');
  }
  // `cwd: repo` é o que faz o gerador enxergar as tags acima, e não as do
  // repositório onde a suite está rodando.
  execFileSync('node', [SCRIPT, destino], { encoding: 'utf8', cwd: repo });
  return {
    destino,
    indice: readFileSync(path.join(destino, 'index.html'), 'utf8'),
    erro: readFileSync(path.join(destino, '404.html'), 'utf8'),
  };
}

/**
 * Executa o script do `404.html` contra uma URL, e devolve para onde ele manda
 * (ou `null` quando decide não mandar para lugar nenhum).
 *
 * O que interessa nesse arquivo é COMPORTAMENTO, não a string do fonte: depois
 * do ADR 0073 ele decide entre reescrever um prefixo aposentado, ficar quieto
 * dentro de um degrau publicado e reencaminhar o resto. Asserção sobre o texto
 * do script confundiria os três casos — é justamente o tipo de erro que ele
 * existe para não cometer.
 */
function redirecionoDe(erro: string, url: string): string | null {
  // A flag `i` não é zelo: sem ela o CodeQL aponta `js/bad-tag-filter` (HIGH),
  // e com razão como regra geral — regex que casa `<script>` e ignora
  // `<SCRIPT>` é o defeito clássico de sanitizador de HTML. Aqui não há
  // sanitização (o teste extrai o script de um arquivo que o PRÓPRIO gerador
  // acabou de escrever), mas a correção é de um caractere e deixa o teste
  // honesto: se o gerador um dia emitir a tag em outra caixa, ele continua
  // encontrando em vez de estourar com "404.html sem <script>".
  const script = /<script>([\s\S]*?)<\/script>/i.exec(erro);
  if (script === null) throw new Error('404.html sem <script>');

  const alvo = new URL(`https://daneiel.github.io${url}`);
  let destino: string | null = null;
  const janela = {
    location: {
      pathname: alvo.pathname,
      search: alvo.search,
      hash: alvo.hash,
      replace: (para: string) => {
        destino = para;
      },
    },
  };

  new Function('window', script[1])(janela);
  return destino;
}

describe('landing — a página que escolhe o degrau', () => {
  it('oferece os três quando os três estão na árvore', () => {
    const { indice } = gerar(['prd', 'qa', 'dev']);
    expect(indice).toContain('href="./prd/"');
    expect(indice).toContain('href="./qa/"');
    expect(indice).toContain('href="./dev/"');
  });

  it('NÃO oferece link para degrau ausente da árvore', () => {
    // O link viria de uma lista fixa se ninguém olhasse o disco — e ofereceria
    // um 404 no primeiro deploy, antes de a esteira ter rodado nos três.
    const { indice } = gerar(['prd']);
    expect(indice).toContain('href="./prd/"');
    expect(indice).not.toContain('href="./qa/"');
    expect(indice).not.toContain('href="./dev/"');
  });

  it('o degrau estável mora em /prd/, e nunca em /main/', () => {
    // O ADR 0073 separou o CAMINHO publicado do nome da branch. Uma árvore com
    // `main/` é a de antes da mudança: ela não pode virar link nenhum.
    const { indice } = gerar(['main']);
    expect(indice).not.toContain('href="./main/"');
    expect(indice).toContain('Nenhum degrau publicado ainda');
  });

  it('mostra a versão carimbada de cada degrau', () => {
    const { indice } = gerar(['prd', 'qa'], ['v9.9.9', 'v9.9.9-qa.7', 'v9.9.9-dev.3']);
    expect(indice).toContain('v9.9.9-qa.7');
    // O `/prd/` lê a tag da `main` — o caminho mudou, a branch que carimba não.
    // E pega a última FINAL, nunca uma pré-release: o glob dela casa o prefixo
    // de `v9.9.9-qa.7` também, e é o filtro que separa as duas.
    expect(indice).toContain('>v9.9.9<');
    expect(indice).not.toContain('>v9.9.9-dev.3<');
  });

  it('diz que não há versão quando o degrau existe mas não há tag', () => {
    // Repositório sem tag nenhuma: a página não pode inventar uma versão.
    const { indice } = gerar(['prd'], []);
    expect(indice).toContain('sem versão carimbada');
  });

  it('se explica quando nenhum degrau foi publicado ainda', () => {
    const { indice } = gerar([]);
    expect(indice).toContain('Nenhum degrau publicado ainda');
    expect(indice).not.toContain('href="./prd/"');
  });

  it('a raiz sai do índice de busca e aponta o canônico para /prd/', () => {
    // A raiz é um índice, não conteúdo. Indexada, competiria com a
    // documentação real nos resultados.
    const { indice } = gerar(['prd']);
    expect(indice).toContain('name="robots" content="noindex, follow"');
    expect(indice).toContain('rel="canonical" href="https://daneiel.github.io/brabo/prd/"');
  });

  it('gera o .nojekyll — sem ele o Pages come os diretórios com _', () => {
    const { destino } = gerar(['prd']);
    expect(() => readFileSync(path.join(destino, '.nojekyll'))).not.toThrow();
  });
});

describe('landing — o 404 que segura os links antigos', () => {
  it('reencaminha caminho desconhecido para o mesmo lugar dentro de /prd/', () => {
    const { erro } = gerar(['prd']);
    expect(redirecionoDe(erro, '/brabo/architecture')).toBe('/brabo/prd/architecture');
  });

  it('preserva query e âncora ao reencaminhar', () => {
    const { erro } = gerar(['prd']);
    expect(redirecionoDe(erro, '/brabo/business-rules?q=1#rn-105')).toBe(
      '/brabo/prd/business-rules?q=1#rn-105',
    );
  });

  it('reescreve /brabo/main/<algo> para /brabo/prd/<algo>', () => {
    // O ADR 0073 aposentou o diretório `main/`, e a árvore é publicada com
    // `keep_files: false`: ele SOME. Todo link salvo para lá tem de pousar no
    // mesmo documento sob `/prd/` — e não em `/brabo/prd/main/<algo>`, que é o
    // que o reencaminhamento genérico produziria se `main` não tivesse caso
    // próprio.
    const { erro } = gerar(['prd']);
    expect(redirecionoDe(erro, '/brabo/main/architecture')).toBe('/brabo/prd/architecture');
    expect(redirecionoDe(erro, '/brabo/main/adr/0071-publicacao-simetrica-por-degrau')).toBe(
      '/brabo/prd/adr/0071-publicacao-simetrica-por-degrau',
    );
    expect(redirecionoDe(erro, '/brabo/main/')).toBe('/brabo/prd/');
    expect(redirecionoDe(erro, '/brabo/main')).toBe('/brabo/prd/');
  });

  it('tem a guarda que impede o laço de redirecionamento', () => {
    // Sem ela, uma página inexistente DENTRO de /prd/ seria reencaminhada
    // para /prd/ de novo, e o navegador ficaria girando. A guarda cobre os
    // caminhos que EXISTEM — e `main` saiu dela junto com o diretório.
    const { erro } = gerar(['prd']);
    expect(redirecionoDe(erro, '/brabo/prd/pagina-que-nao-existe')).toBeNull();
    expect(redirecionoDe(erro, '/brabo/qa/pagina-que-nao-existe')).toBeNull();
    expect(redirecionoDe(erro, '/brabo/dev/pagina-que-nao-existe')).toBeNull();
  });

  it('não mexe em caminho fora de /brabo/', () => {
    const { erro } = gerar(['prd']);
    expect(redirecionoDe(erro, '/outra-coisa')).toBeNull();
  });
});

describe('landing — falhas', () => {
  it('sem diretório de saída, sai != 0 e diz o uso', () => {
    expect.assertions(2);
    try {
      execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
    } catch (erro) {
      const falha = erro as { status: number; stderr: string };
      expect(falha.status).toBe(2);
      expect(falha.stderr).toContain('uso:');
    }
  });
});
