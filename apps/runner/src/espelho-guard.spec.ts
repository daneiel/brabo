import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  arquivoRegular,
  caminhoNoDestino,
  DestinoDeEspelhoInvalidoError,
  mesmoCaminho,
  validarDestinoDeEspelho,
} from './espelho-guard.ts';

/**
 * ADR 0147 ponto 2 / RN-516 — a guarda do destino do espelho.
 *
 * Os symlinks são CRIADOS DE VERDADE em `tmp`, nunca simulados: a segunda
 * passada desta guarda é justamente a que resolve `realpath`, e um teste com
 * link falso provaria só a primeira (que a api já faz, e que por si só não
 * pega nada disto).
 */
describe('validarDestinoDeEspelho', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-espelho-guard-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('caminho feliz: destino irmão da pasta do projeto passa e volta normalizado', () => {
    const workspace = join(raiz, 'projeto');
    const destino = join(raiz, 'meu-espelho');
    mkdirSync(workspace, { recursive: true });

    expect(validarDestinoDeEspelho(`${destino}/`, workspace)).toEqual({
      destino,
      workspace,
    });
  });

  it('destino DENTRO do workspace é recusado — o espelho copiaria o próprio espelho', () => {
    const workspace = join(raiz, 'projeto');
    mkdirSync(workspace, { recursive: true });

    const erro = capturar(() =>
      validarDestinoDeEspelho(join(workspace, 'espelho'), workspace),
    );

    expect(erro).toBeInstanceOf(DestinoDeEspelhoInvalidoError);
    expect(erro.motivo).toBe('destino-dentro-do-workspace');
  });

  it('destino que CONTÉM o workspace é recusado — o mesmo laço, no sentido contrário', () => {
    const workspace = join(raiz, 'pai', 'projeto');
    mkdirSync(workspace, { recursive: true });

    const erro = capturar(() => validarDestinoDeEspelho(join(raiz, 'pai'), workspace));

    expect(erro).toBeInstanceOf(DestinoDeEspelhoInvalidoError);
    expect(erro.motivo).toBe('destino-contem-o-workspace');
  });

  it('destino IGUAL ao workspace é recusado (o laço mais direto que existe)', () => {
    const workspace = join(raiz, 'projeto');
    mkdirSync(workspace, { recursive: true });

    expect(capturar(() => validarDestinoDeEspelho(workspace, workspace)).motivo).toBe(
      'destino-dentro-do-workspace',
    );
  });

  it('SYMLINK que escapa: destino lexicamente fora, mas apontando para dentro do projeto', () => {
    const workspace = join(raiz, 'projeto');
    mkdirSync(join(workspace, 'src'), { recursive: true });

    // `/<raiz>/atalho` -> `/<raiz>/projeto/src`. A forma lexical é impecável
    // (irmã do projeto); só o `realpath` revela o laço.
    const destino = join(raiz, 'atalho');
    symlinkSync(join(workspace, 'src'), destino, 'dir');

    const erro = capturar(() => validarDestinoDeEspelho(destino, workspace));

    expect(erro).toBeInstanceOf(DestinoDeEspelhoInvalidoError);
    expect(erro.motivo).toBe('destino-dentro-do-workspace');
  });

  it('SYMLINK num segmento do MEIO do destino também é pego', () => {
    const workspace = join(raiz, 'projeto');
    mkdirSync(workspace, { recursive: true });

    const meio = join(raiz, 'meio');
    symlinkSync(workspace, meio, 'dir');

    // `/<raiz>/meio/dentro` — o segmento `meio` é o link, e o alvo ainda não
    // existe; `realpathMaisProximo` resolve o ancestral que existe.
    const erro = capturar(() => validarDestinoDeEspelho(join(meio, 'dentro'), workspace));

    expect(erro.motivo).toBe('destino-dentro-do-workspace');
  });

  it('`/base-outra` NÃO está dentro de `/base` — comparação por SEGMENTO, nunca startsWith cru', () => {
    // Uma pasta irmã cujo nome começa igual é legítima, e taxá-la seria o
    // defeito inverso da recusa.
    expect(validarDestinoDeEspelho('/base-outra', '/base')).toEqual({
      destino: '/base-outra',
      workspace: '/base',
    });
    expect(validarDestinoDeEspelho('/base', '/base-outra')).toEqual({
      destino: '/base',
      workspace: '/base-outra',
    });
  });

  it('recusa o léxico que chegou pela rede: relativo, `..`, vazio e byte nulo', () => {
    const workspace = '/home/voce/projeto';

    for (const invalido of ['relativo/espelho', '/home/voce/../etc', '', '/home/\0/x']) {
      expect(capturar(() => validarDestinoDeEspelho(invalido, workspace)).motivo).toBe(
        'lexico',
      );
    }
  });

  it('NADA é criado no disco pela guarda — o `mkdir -p` só vem depois dela', () => {
    const workspace = join(raiz, 'projeto');
    mkdirSync(workspace, { recursive: true });
    const destino = join(raiz, 'ainda-nao-existe', 'fundo');

    expect(validarDestinoDeEspelho(destino, workspace).destino).toBe(destino);
    expect(arquivoRegular(destino)).toBe(false);
  });
});

describe('caminhoNoDestino (a recusa por ARQUIVO)', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-espelho-alvo-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('alvo comum dentro do destino passa, inclusive quando ainda não existe', () => {
    const destino = join(raiz, 'espelho');
    mkdirSync(destino, { recursive: true });

    expect(caminhoNoDestino(join(destino, 'src', 'a.ts'), destino)).toBe(true);
  });

  it('symlink de um segmento do meio apontando para FORA do destino é recusado', () => {
    const destino = join(raiz, 'espelho');
    const fora = join(raiz, 'fora');
    mkdirSync(destino, { recursive: true });
    mkdirSync(fora, { recursive: true });

    symlinkSync(fora, join(destino, 'sub'), 'dir');

    expect(caminhoNoDestino(join(destino, 'sub', 'x.txt'), destino)).toBe(false);
  });

  it('alvo que JÁ EXISTE como symlink para fora é recusado — escrever seguiria o link', () => {
    const destino = join(raiz, 'espelho');
    const fora = join(raiz, 'fora');
    mkdirSync(destino, { recursive: true });
    mkdirSync(fora, { recursive: true });
    writeFileSync(join(fora, 'alvo.txt'), 'de fora');

    symlinkSync(join(fora, 'alvo.txt'), join(destino, 'alvo.txt'));

    expect(caminhoNoDestino(join(destino, 'alvo.txt'), destino)).toBe(false);
  });

  it('caminho lexicamente fora do destino é recusado antes de qualquer realpath', () => {
    const destino = join(raiz, 'espelho');
    mkdirSync(destino, { recursive: true });

    expect(caminhoNoDestino(join(raiz, 'outro', 'a.txt'), destino)).toBe(false);
    // Irmão com prefixo igual: o mesmo cuidado por segmento da guarda do destino.
    expect(caminhoNoDestino(`${destino}-outro/a.txt`, destino)).toBe(false);
  });
});

describe('arquivoRegular', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-espelho-lstat-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('arquivo sim; pasta, symlink e inexistente não (lstat, nunca stat)', () => {
    const arquivo = join(raiz, 'a.txt');
    writeFileSync(arquivo, 'x');
    const link = join(raiz, 'link.txt');
    symlinkSync(arquivo, link);

    expect(arquivoRegular(arquivo)).toBe(true);
    expect(arquivoRegular(raiz)).toBe(false);
    // `stat` diria `true` aqui — a diferença é o ponto: seguir o link traria
    // conteúdo de fora do projeto para a pasta pessoal de alguém.
    expect(arquivoRegular(link)).toBe(false);
    expect(arquivoRegular(join(raiz, 'sumiu.txt'))).toBe(false);
  });
});

describe('mesmoCaminho', () => {
  it('barra final e duplicada não fazem diferença; caminho diferente faz', () => {
    expect(mesmoCaminho('/a/b', '/a/b/')).toBe(true);
    expect(mesmoCaminho('/a//b', '/a/b')).toBe(true);
    expect(mesmoCaminho('/a/b', '/a/b-outra')).toBe(false);
  });
});

function capturar(fn: () => unknown): DestinoDeEspelhoInvalidoError {
  try {
    fn();
  } catch (erro) {
    return erro as DestinoDeEspelhoInvalidoError;
  }
  throw new Error('esperava uma recusa, e a guarda deixou passar');
}
