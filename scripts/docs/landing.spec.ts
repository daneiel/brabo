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

describe('landing — a página que escolhe o degrau', () => {
  it('oferece os três quando os três estão na árvore', () => {
    const { indice } = gerar(['main', 'qa', 'dev']);
    expect(indice).toContain('href="./main/"');
    expect(indice).toContain('href="./qa/"');
    expect(indice).toContain('href="./dev/"');
  });

  it('NÃO oferece link para degrau ausente da árvore', () => {
    // O link viria de uma lista fixa se ninguém olhasse o disco — e ofereceria
    // um 404 no primeiro deploy, antes de a esteira ter rodado nos três.
    const { indice } = gerar(['main']);
    expect(indice).toContain('href="./main/"');
    expect(indice).not.toContain('href="./qa/"');
    expect(indice).not.toContain('href="./dev/"');
  });

  it('mostra a versão carimbada de cada degrau', () => {
    const { indice } = gerar(['main', 'qa'], ['v9.9.9', 'v9.9.9-qa.7', 'v9.9.9-dev.3']);
    expect(indice).toContain('v9.9.9-qa.7');
    // A `main` pega a última FINAL, nunca uma pré-release — o glob dela casa o
    // prefixo de `v9.9.9-qa.7` também, e é o filtro que separa as duas.
    expect(indice).toContain('>v9.9.9<');
    expect(indice).not.toContain('>v9.9.9-dev.3<');
  });

  it('diz que não há versão quando o degrau existe mas não há tag', () => {
    // Repositório sem tag nenhuma: a página não pode inventar uma versão.
    const { indice } = gerar(['main'], []);
    expect(indice).toContain('sem versão carimbada');
  });

  it('se explica quando nenhum degrau foi publicado ainda', () => {
    const { indice } = gerar([]);
    expect(indice).toContain('Nenhum degrau publicado ainda');
    expect(indice).not.toContain('href="./main/"');
  });

  it('a raiz sai do índice de busca e aponta o canônico para /main/', () => {
    // A raiz é um índice, não conteúdo. Indexada, competiria com a
    // documentação real nos resultados.
    const { indice } = gerar(['main']);
    expect(indice).toContain('name="robots" content="noindex, follow"');
    expect(indice).toContain('rel="canonical" href="https://daneiel.github.io/brabo/main/"');
  });

  it('gera o .nojekyll — sem ele o Pages come os diretórios com _', () => {
    const { destino } = gerar(['main']);
    expect(() => readFileSync(path.join(destino, '.nojekyll'))).not.toThrow();
  });
});

describe('landing — o 404 que segura os links antigos', () => {
  it('reencaminha para o mesmo caminho dentro de /main/', () => {
    const { erro } = gerar(['main']);
    expect(erro).toContain("raiz + 'main/' + resto");
  });

  it('tem a guarda que impede o laço de redirecionamento', () => {
    // Sem ela, uma página inexistente DENTRO de /main/ seria reencaminhada
    // para /main/ de novo, e o navegador ficaria girando.
    const { erro } = gerar(['main']);
    expect(erro).toContain('(main|qa|dev)');
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
