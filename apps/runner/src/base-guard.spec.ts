import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BaseInvalidaError,
  resolverPastaDoProjetoNaBase,
  SegmentoDeProjetoInvalidoError,
  validarBaseDeProjetos,
} from './base-guard.ts';

/**
 * ADR 0151 pontos 1 e 2 / RN-529 — a base de projetos do runner.
 *
 * Os symlinks são CRIADOS DE VERDADE em `tmp`, nunca simulados: a segunda
 * passada desta guarda é justamente a que resolve `realpath`, e um teste com
 * link falso provaria só a primeira.
 *
 * `mkdtempSync` devolve um caminho que, no macOS, passa por `/var -> /private/var`.
 * Por isso a raiz é resolvida com `realpathSync` antes de qualquer comparação:
 * sem isso a asserção de igualdade compararia o caminho lexical com o real.
 */
describe('validarBaseDeProjetos', () => {
  let raiz: string;
  let projeto: string;

  beforeEach(() => {
    raiz = realpathSync(mkdtempSync(join(tmpdir(), 'brabo-base-guard-')));
    projeto = join(raiz, 'projeto');
    mkdirSync(projeto, { recursive: true });
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  const opcoes = () => ({
    // `darwin` de propósito: a checagem de `$HOME` só vale no Linux (RN-434),
    // e um caminho de `tmp` não está dentro do `$HOME` de ninguém. O caso
    // Linux tem teste próprio, com um `home` sob a raiz temporária.
    plataforma: 'darwin' as NodeJS.Platform,
    home: raiz,
    raizDoProjeto: projeto,
  });

  it('caminho feliz: base irmã da pasta do projeto passa e volta normalizada', () => {
    const base = join(raiz, 'projetos-brabo');

    expect(validarBaseDeProjetos(`${base}/`, opcoes())).toBe(base);
  });

  it('caminho feliz: base que ainda NÃO existe é aceita — quem a cria é o instalador', () => {
    const base = join(raiz, 'nunca-criada', 'projetos-brabo');

    expect(validarBaseDeProjetos(base, opcoes())).toBe(base);
  });

  it('base irmã com prefixo comum NÃO é confundida — comparação por segmento', () => {
    // `/…/projeto-base` começa com `/…/projeto`, e um `startsWith` cru a
    // recusaria como se estivesse dentro da pasta do projeto.
    const base = `${projeto}-base`;

    expect(validarBaseDeProjetos(base, opcoes())).toBe(base);
  });

  it('base relativa é recusada por léxico', () => {
    const erro = capturarBase(() => validarBaseDeProjetos('projetos-brabo', opcoes()));

    expect(erro).toBeInstanceOf(BaseInvalidaError);
    expect(erro.motivo).toBe('lexico');
  });

  it('base com ".." é recusada por léxico, ANTES de qualquer resolução', () => {
    // String literal, nunca `join(raiz, '..', …)`: `join` normaliza o `..` e o
    // teste passaria a provar outra coisa. O que se recusa aqui é a string que
    // chegou com `..`, não o caminho para onde ela resolve.
    const erro = capturarBase(() => validarBaseDeProjetos(`${raiz}/../fora`, opcoes()));

    expect(erro.motivo).toBe('lexico');
  });

  it('base "/" é recusada — não delimita nada', () => {
    const erro = capturarBase(() => validarBaseDeProjetos('/', opcoes()));

    expect(erro.motivo).toBe('raiz-do-fs');
  });

  it('base que já existe e é ARQUIVO é recusada — nunca sobrescrita', () => {
    const arquivo = join(raiz, 'nao-e-pasta');
    writeFileSync(arquivo, 'x');

    const erro = capturarBase(() => validarBaseDeProjetos(arquivo, opcoes()));

    expect(erro.motivo).toBe('nao-e-pasta');
  });

  it('no LINUX, base fora do $HOME é recusada — a RN-434 reusada, com mensagem própria', () => {
    const home = join(raiz, 'home', 'alguem');
    mkdirSync(home, { recursive: true });

    const erro = capturarBase(() =>
      validarBaseDeProjetos(join(raiz, 'fora-do-home'), {
        plataforma: 'linux',
        home,
        raizDoProjeto: projeto,
      }),
    );

    expect(erro.motivo).toBe('fora-do-home');
    // A mensagem fala da BASE. `--dir` só aparece como REFERÊNCIA à regra que
    // já existia — nunca como a coisa a corrigir, que é o que a frase de
    // `DirForaDoHomeError` diria se fosse reaproveitada crua.
    expect(erro.message).toContain('a base precisa estar dentro');
    expect(erro.message).not.toContain('--dir precisa estar');
  });

  it('base DENTRO da pasta deste projeto é recusada — todo projeto novo nasceria aqui', () => {
    const erro = capturarBase(() =>
      validarBaseDeProjetos(join(projeto, 'projetos-brabo'), opcoes()),
    );

    expect(erro.motivo).toBe('base-dentro-da-raiz');
  });

  it('base IGUAL à pasta deste projeto é recusada — o mesmo laço', () => {
    const erro = capturarBase(() => validarBaseDeProjetos(projeto, opcoes()));

    expect(erro.motivo).toBe('base-dentro-da-raiz');
  });

  it('base cujo ancestral é SYMLINK para dentro do projeto é recusada — a segunda passada', () => {
    // Forma lexical impecável: `<raiz>/atalho/projetos-brabo` não está dentro
    // de `<raiz>/projeto`. Só o `realpath` vê o laço.
    symlinkSync(projeto, join(raiz, 'atalho'));

    const erro = capturarBase(() =>
      validarBaseDeProjetos(join(raiz, 'atalho', 'projetos-brabo'), opcoes()),
    );

    expect(erro.motivo).toBe('base-dentro-da-raiz');
  });

  it('`raizDoProjeto: null` (agente de MÁQUINA) não recusa por laço — não há sujeito (RN-544)', () => {
    // Sem `--project` não há `--dir`, e toda raiz de projeto é DERIVADA da
    // base. O laço que a checagem recusa ("a base dentro da raiz de um
    // projeto") não tem como ser construído — e passar a própria base aqui
    // seria pior que `null`: `dentroDoEscopo(base, base)` é verdadeiro, e toda
    // base seria recusada.
    const base = join(raiz, 'projetos-brabo');

    expect(
      validarBaseDeProjetos(base, { plataforma: 'darwin', home: raiz, raizDoProjeto: null }),
    ).toBe(base);
  });

  it('`raizDoProjeto: null` NÃO afrouxa as outras recusas — só a do laço perde sujeito', () => {
    const erro = capturarBase(() =>
      validarBaseDeProjetos('/', { plataforma: 'darwin', home: raiz, raizDoProjeto: null }),
    );

    expect(erro.motivo).toBe('raiz-do-fs');
  });

  it('o SENTIDO CONTRÁRIO é o arranjo normal: a pasta do projeto DENTRO da base passa', () => {
    // Assimetria deliberada (ver o docblock do módulo): no espelho os dois
    // sentidos são defeito; aqui um deles é exatamente o que o ADR desenha.
    const base = join(raiz, 'projetos-brabo');
    const projetoNaBase = join(base, 'loja');
    mkdirSync(projetoNaBase, { recursive: true });

    expect(
      validarBaseDeProjetos(base, {
        plataforma: 'darwin',
        home: raiz,
        raizDoProjeto: projetoNaBase,
      }),
    ).toBe(base);
  });
});

describe('resolverPastaDoProjetoNaBase', () => {
  let raiz: string;
  let base: string;

  beforeEach(() => {
    raiz = realpathSync(mkdtempSync(join(tmpdir(), 'brabo-base-seg-')));
    base = join(raiz, 'projetos-brabo');
    mkdirSync(base, { recursive: true });
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('caminho feliz: o segmento vira a subpasta absoluta, mesmo sem existir', () => {
    expect(resolverPastaDoProjetoNaBase(base, 'loja')).toBe(join(base, 'loja'));
  });

  it('caminho feliz: segmento com mais de um nível', () => {
    expect(resolverPastaDoProjetoNaBase(base, 'time/loja')).toBe(join(base, 'time', 'loja'));
  });

  it('segmento ABSOLUTO é recusado — o que atravessa a rede é o segmento (ADR 0130)', () => {
    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, '/etc'));

    expect(erro).toBeInstanceOf(SegmentoDeProjetoInvalidoError);
    expect(erro.motivo).toBe('lexico');
  });

  it('segmento com ".." é recusado por léxico, antes de resolver qualquer coisa', () => {
    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, '../fora'));

    expect(erro.motivo).toBe('lexico');
  });

  it('segmento vazio é recusado por léxico', () => {
    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, ''));

    expect(erro.motivo).toBe('lexico');
  });

  it('segmento que aponta para a PRÓPRIA base é recusado', () => {
    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, '.'));

    expect(erro.motivo).toBe('e-a-propria-base');
  });

  it('subpasta que é SYMLINK para fora da base é recusada — a segunda passada', () => {
    const fora = join(raiz, 'fora');
    mkdirSync(fora, { recursive: true });
    symlinkSync(fora, join(base, 'loja'));

    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, 'loja'));

    expect(erro.motivo).toBe('escapa-da-base');
  });

  it('segmento cujo diretório do MEIO é symlink para fora é recusado', () => {
    const fora = join(raiz, 'fora');
    mkdirSync(fora, { recursive: true });
    symlinkSync(fora, join(base, 'time'));

    const erro = capturarSegmento(() => resolverPastaDoProjetoNaBase(base, 'time/loja'));

    expect(erro.motivo).toBe('escapa-da-base');
  });
});

function capturarBase(fn: () => unknown): BaseInvalidaError {
  try {
    fn();
  } catch (erro) {
    return erro as BaseInvalidaError;
  }
  throw new Error('esperava BaseInvalidaError, mas nada foi lançado');
}

function capturarSegmento(fn: () => unknown): SegmentoDeProjetoInvalidoError {
  try {
    fn();
  } catch (erro) {
    return erro as SegmentoDeProjetoInvalidoError;
  }
  throw new Error('esperava SegmentoDeProjetoInvalidoError, mas nada foi lançado');
}
