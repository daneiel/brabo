import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aferir, candidatos, conferir, extrairRefs, resolverCaminho } from './refs-com-simbolo.mjs';

/**
 * A regra (AT-096): uma ref `caminho:N` seguida de `(`símbolo`` numa RN diz
 * que o símbolo mora na linha N; a aferição confere isso numa janela pequena.
 * O padrão é estreito — o que é ambíguo fica de FORA, nunca vira "não bate".
 */

const simbolos = (texto: string) =>
  (extrairRefs(texto) as { caminho: string; linha: number; simbolo: string }[]).map(
    (r) => `${r.caminho}:${r.linha}=${r.simbolo}`,
  );

describe('extrairRefs', () => {
  it('pega a ref explícita e a de continuação, que herda o caminho', () => {
    const rn = '- **Código:** `install.sh:966` (`fechar_a_instalacao`, o encadeamento), `:682`\n  (`post_interno`, o corpo)';
    expect(simbolos(rn)).toEqual(['install.sh:966=fechar_a_instalacao', 'install.sh:682=post_interno']);
  });

  it('aceita quebra de linha entre a ref e o parêntese', () => {
    expect(simbolos('`a/b.ts:10`\n  (`foo`)')).toEqual(['a/b.ts:10=foo']);
  });

  it('continuação sem caminho no MESMO item fica de fora', () => {
    const rn = '- `a.ts:1` (`x`)\n- outro item, `:5` (`y`)';
    expect(simbolos(rn)).toEqual(['a.ts:1=x']);
  });

  it('linha em branco também encerra o item', () => {
    expect(simbolos('`a.ts:1` (`x`)\n\n`:5` (`y`)')).toEqual(['a.ts:1=x']);
  });

  it('par separado por `/` é ambíguo e fica de fora, dos dois lados', () => {
    const rn = '`install.sh:10` (`z`), `:640`/`:647` (`escapar_json`/`sem_controle`)';
    expect(simbolos(rn)).toEqual(['install.sh:10=z']);
  });

  it('duas refs por `/` e UM símbolo: qual das duas? fica de fora', () => {
    expect(simbolos('`a.ts:1`/`:2` (`foo`)')).toEqual([]);
  });

  it('símbolo seguido de `/` é ambíguo mesmo com uma ref só', () => {
    expect(simbolos('`a.ts:3` (`um`/`outro`)')).toEqual([]);
  });

  it('o que não é identificador não é símbolo', () => {
    expect(simbolos('`install.sh:79` (`MARCADOR_SCHEMA=3`), `:80` (o marcador)')).toEqual([]);
  });

  it('faixa e lista de linhas não casam', () => {
    expect(simbolos('`a.ts:10-20` (`foo`), `a.ts:10,20` (`bar`)')).toEqual([]);
  });

  it('ref sem cara de arquivo não é caminho', () => {
    expect(simbolos('`localhost:3000` (`api`)')).toEqual([]);
  });

  it('aceita símbolo de Elixir com aridade e `?`, e nome com ponto', () => {
    expect(simbolos('`x.ex:1` (`join/3`), `:2` (`git_dir?`), `:3` (`Engine.Foo.bar`), `:4` (`decide()`)')).toEqual([
      'x.ex:1=join/3',
      'x.ex:2=git_dir?',
      'x.ex:3=Engine.Foo.bar',
      'x.ex:4=decide()',
    ]);
  });
});

describe('conferir', () => {
  const arquivo = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`);
  arquivo[9] = 'post_interno() {';
  arquivo[19] = '  onConfirmado?: () => void;';
  arquivo[24] = '  def git_dir?(caminho) do';

  it('bate na linha exata e dentro da janela', () => {
    expect(conferir(arquivo, 10, 'post_interno').bate).toBe(true);
    expect(conferir(arquivo, 13, 'post_interno').bate).toBe(true);
    expect(conferir(arquivo, 7, 'post_interno').bate).toBe(true);
  });

  it('fora da janela não bate, e diz onde o símbolo está', () => {
    expect(conferir(arquivo, 14, 'post_interno')).toEqual({ bate: false, achadoEm: 10 });
    expect(conferir(arquivo, 14, 'sumiu')).toEqual({ bate: false, achadoEm: null });
  });

  it('palavra inteira: prefixo de outro nome não conta', () => {
    expect(conferir(arquivo, 10, 'post').bate).toBe(false);
  });

  it('campo opcional de TS (`x?:`) é o nome `x`', () => {
    expect(conferir(arquivo, 20, 'onConfirmado').bate).toBe(true);
  });

  it('em Elixir `git_dir?` não é `git_dir`', () => {
    expect(conferir(arquivo, 25, 'git_dir?/1').bate).toBe(true);
    expect(conferir(arquivo, 25, 'git_dir').bate).toBe(false);
  });

  it('linha além do fim do arquivo não bate', () => {
    expect(conferir(arquivo, 500, 'post_interno').bate).toBe(false);
    // Nem por acidente: linha inexistente não vira o texto "undefined".
    expect(conferir(arquivo, 500, 'undefined').bate).toBe(false);
  });

  it('nome com ponto procura também o último segmento', () => {
    expect(candidatos('Engine.Runners.RunnerReadiness')).toEqual(['Engine.Runners.RunnerReadiness', 'RunnerReadiness']);
    expect(candidatos('decide()')).toEqual(['decide']);
  });
});

describe('resolverCaminho e aferir', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'refs-'));
  mkdirSync(join(raiz, 'apps/a'), { recursive: true });
  mkdirSync(join(raiz, 'apps/b'), { recursive: true });
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  writeFileSync(join(raiz, 'apps/a/decide.ts'), 'x\nexport function decide() {}\n');
  writeFileSync(join(raiz, 'apps/a/dup.ts'), 'x\n');
  writeFileSync(join(raiz, 'apps/b/dup.ts'), 'x\n');
  writeFileSync(join(raiz, 'install.sh'), 'a\nb\npost_interno() {\n');
  const versionados = ['apps/a/decide.ts', 'apps/a/dup.ts', 'apps/b/dup.ts', 'install.sh'];

  it('resolve da raiz, ou pelo ÚNICO arquivo que termina no caminho', () => {
    expect(resolverCaminho('install.sh', raiz, versionados)).toBe('install.sh');
    expect(resolverCaminho('decide.ts', raiz, versionados)).toBe('apps/a/decide.ts');
    expect(resolverCaminho('dup.ts', raiz, versionados)).toBeNull();
  });

  it('conta, confere e separa o que não resolve', () => {
    writeFileSync(
      join(raiz, 'docs/rn.md'),
      '- `install.sh:3` (`post_interno`), `:30` (`post_interno`)\n- `decide.ts:2` (`decide()`)\n- `dup.ts:1` (`x`)\n',
    );
    const r = aferir(raiz, versionados, ['docs/rn.md']);
    expect(r.total).toBe(3);
    expect(r.batem).toBe(2);
    expect(r.naoBatem).toHaveLength(1);
    expect(r.naoBatem[0]).toMatchObject({ resolvido: 'install.sh', linha: 30, achadoEm: 3, linhaNoDoc: 1 });
    expect(r.naoResolvidas).toHaveLength(1);
  });
});
