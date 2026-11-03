import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AT-722: o acesso rápido por papel só existe com `BRABO_AMBIENTE=local`, e
 * nada publicado por GitHub Actions pode recebê-lo. Três travas:
 * (i) nenhum workflow põe `local` numa variável de ambiente da imagem;
 * (ii) os workflows que constroem a imagem para testar/publicar (`ci.yml`,
 *      `release.yml`) passam `AMBIENTE` no passo do bake — `propriedades.yml`
 *      fica de fora de propósito: o default VAZIO do bake já é seguro;
 * (iii) o default de `AMBIENTE` no `docker-bake.hcl` é vazio.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COM_AMBIENTE_OBRIGATORIO = ['ci.yml', 'release.yml'];

type Arquivo = { nome: string; conteudo: string };

function violacoesDeLocal(arquivos: Arquivo[]): string[] {
  return arquivos.flatMap(({ nome, conteudo }) =>
    conteudo
      .split('\n')
      .flatMap((linha, i) =>
        /^\s*(?:VITE_)?(?:BRABO_)?AMBIENTE\s*:\s*['"]?local\b/.test(linha) ? [`${nome}:${i + 1} põe AMBIENTE=local`] : [],
      ),
  );
}

function bakesSemAmbiente(arquivos: Arquivo[]): string[] {
  return arquivos
    .filter((a) => COM_AMBIENTE_OBRIGATORIO.includes(a.nome))
    .flatMap(({ nome, conteudo }) =>
      conteudo
        .split(/^\s*- (?=name:|uses:|id:)/m)
        .filter((passo) => passo.includes('docker/bake-action@'))
        .filter((passo) => !/^\s*AMBIENTE\s*:\s*\S+/m.test(passo))
        .map(() => `${nome}: passo de bake sem AMBIENTE`),
    );
}

function defaultDoBakeNaoVazio(hcl: string): string[] {
  const m = /variable\s+"AMBIENTE"\s*\{[^}]*default\s*=\s*"([^"]*)"/.exec(hcl);
  if (!m) return ['docker-bake.hcl sem variable "AMBIENTE"'];
  return m[1] === '' ? [] : [`default de AMBIENTE no bake é "${m[1]}", deveria ser vazio`];
}

const wf = (nome: string, conteudo: string): Arquivo[] => [{ nome, conteudo }];
const BAKE_OK = `      - name: Build\n        uses: docker/bake-action@abc  # v7\n        env:\n          AMBIENTE: prd\n`;

describe('regras (cada uma reprova a forma errada)', () => {
  it('reprova local em workflow', () => {
    expect(violacoesDeLocal(wf('x.yml', '          AMBIENTE: local'))).toHaveLength(1);
    expect(violacoesDeLocal(wf('x.yml', '          BRABO_AMBIENTE: "local"'))).toHaveLength(1);
    expect(violacoesDeLocal(wf('x.yml', '          AMBIENTE: prd'))).toEqual([]);
  });

  it('reprova bake sem AMBIENTE em ci/release', () => {
    expect(bakesSemAmbiente(wf('release.yml', BAKE_OK))).toEqual([]);
    expect(bakesSemAmbiente(wf('release.yml', BAKE_OK.replace('AMBIENTE: prd', 'TAG: x')))).toHaveLength(1);
    expect(bakesSemAmbiente(wf('propriedades.yml', BAKE_OK.replace('AMBIENTE: prd', 'TAG: x')))).toEqual([]);
  });

  it('reprova default não vazio no bake', () => {
    expect(defaultDoBakeNaoVazio('variable "AMBIENTE" {\n  default = ""\n}')).toEqual([]);
    expect(defaultDoBakeNaoVazio('variable "AMBIENTE" {\n  default = "local"\n}')).toHaveLength(1);
    expect(defaultDoBakeNaoVazio('variable "VERSION" {}')).toHaveLength(1);
  });
});

describe('o repositório real', () => {
  const dir = path.join(RAIZ, '.github/workflows');
  const arquivos = readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((nome) => ({ nome, conteudo: readFileSync(path.join(dir, nome), 'utf8') }));

  it('nenhum workflow liga o ambiente local', () => {
    expect(violacoesDeLocal(arquivos)).toEqual([]);
  });

  it('ci e release passam AMBIENTE no bake', () => {
    expect(arquivos.filter((a) => COM_AMBIENTE_OBRIGATORIO.includes(a.nome))).toHaveLength(2);
    expect(bakesSemAmbiente(arquivos)).toEqual([]);
  });

  it('o default do bake é vazio', () => {
    expect(defaultDoBakeNaoVazio(readFileSync(path.join(RAIZ, 'docker-bake.hcl'), 'utf8'))).toEqual([]);
  });
});
