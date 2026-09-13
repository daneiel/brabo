import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caminhoDoArquivoDeBase,
  lerBaseConsentida,
  resolverBaseConsentida,
} from './base.ts';

/**
 * ADR 0151 ponto 1 / RN-529 — de ONDE a base vem, e o que acontece quando a
 * fonte não presta.
 *
 * O arquivo é escrito DE VERDADE em `tmp`: o que se prova aqui é a precedência
 * (`$XDG_CONFIG_HOME` antes de `~/.config`, flag antes de arquivo) e a
 * separação dos desfechos, e nenhuma das duas sobrevive a um mock do `fs`.
 */
describe('caminhoDoArquivoDeBase', () => {
  it('usa $XDG_CONFIG_HOME quando posto — a mesma precedência de servico.ts', () => {
    expect(caminhoDoArquivoDeBase('/home/eu', '/xdg')).toBe('/xdg/brabo/runner.json');
  });

  it('cai em ~/.config quando XDG_CONFIG_HOME é nulo ou vazio', () => {
    expect(caminhoDoArquivoDeBase('/home/eu', null)).toBe('/home/eu/.config/brabo/runner.json');
    expect(caminhoDoArquivoDeBase('/home/eu', '')).toBe('/home/eu/.config/brabo/runner.json');
  });
});

describe('lerBaseConsentida — os quatro desfechos não colapsam (RN-475)', () => {
  let raiz: string;
  let home: string;

  beforeEach(() => {
    raiz = realpathSync(mkdtempSync(join(tmpdir(), 'brabo-base-')));
    home = join(raiz, 'home');
    mkdirSync(join(home, '.config', 'brabo'), { recursive: true });
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  const escrever = (conteudo: string) =>
    writeFileSync(join(home, '.config', 'brabo', 'runner.json'), conteudo);

  it('arquivo ausente é "ausente" — o caso NORMAL, nunca um erro', () => {
    expect(lerBaseConsentida(home, null)).toEqual({ estado: 'ausente' });
  });

  it('JSON corrompido é "json-invalido", nunca confundido com ausência', () => {
    escrever('{ isto não é json');

    expect(lerBaseConsentida(home, null)).toEqual({ estado: 'json-invalido' });
  });

  it('JSON válido que não é objeto também é "json-invalido"', () => {
    escrever('"texto"');

    expect(lerBaseConsentida(home, null)).toEqual({ estado: 'json-invalido' });
  });

  it('objeto sem "base" é "sem-base" — configuração SEM base, não configuração quebrada', () => {
    escrever('{"outraCoisa": 1}');

    expect(lerBaseConsentida(home, null)).toEqual({ estado: 'sem-base' });
  });

  it('base declarada volta CRUA, sem validação nenhuma neste módulo', () => {
    escrever('{"base": "  /home/eu/projetos-brabo  "}');

    expect(lerBaseConsentida(home, null)).toEqual({
      estado: 'lida',
      base: '/home/eu/projetos-brabo',
    });
  });
});

describe('resolverBaseConsentida', () => {
  let raiz: string;
  let home: string;
  let projeto: string;

  beforeEach(() => {
    raiz = realpathSync(mkdtempSync(join(tmpdir(), 'brabo-base-res-')));
    home = join(raiz, 'home');
    mkdirSync(join(home, '.config', 'brabo'), { recursive: true });
    projeto = join(raiz, 'projeto');
    mkdirSync(projeto, { recursive: true });
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  const escrever = (conteudo: string) =>
    writeFileSync(join(home, '.config', 'brabo', 'runner.json'), conteudo);

  const opcoes = () => ({
    plataforma: 'darwin' as NodeJS.Platform,
    home: raiz,
    raizDoProjeto: projeto,
  });

  it('sem flag e sem arquivo: "ausente" — o binário legado da RN-514 intacto', () => {
    expect(resolverBaseConsentida(undefined, home, null, opcoes())).toEqual({
      estado: 'ausente',
    });
  });

  it('caminho feliz pela FLAG: valida e devolve normalizada, com a origem', () => {
    const base = join(raiz, 'projetos-brabo');

    expect(resolverBaseConsentida(`${base}/`, home, null, opcoes())).toEqual({
      estado: 'ok',
      base,
      origem: 'flag',
    });
  });

  it('caminho feliz pelo ARQUIVO quando não há flag', () => {
    const base = join(raiz, 'projetos-brabo');
    escrever(JSON.stringify({ base }));

    expect(resolverBaseConsentida(undefined, home, null, opcoes())).toEqual({
      estado: 'ok',
      base,
      origem: 'arquivo',
    });
  });

  it('a FLAG vence o arquivo — o mesmo critério de --project/--api-url/--token', () => {
    escrever(JSON.stringify({ base: join(raiz, 'do-arquivo') }));
    const daFlag = join(raiz, 'da-flag');

    expect(resolverBaseConsentida(daFlag, home, null, opcoes())).toEqual({
      estado: 'ok',
      base: daFlag,
      origem: 'flag',
    });
  });

  it('flag inválida é "recusada" com origem flag — o chamador é quem a torna fatal', () => {
    const resultado = resolverBaseConsentida('relativa', home, null, opcoes());

    expect(resultado.estado).toBe('recusada');
    if (resultado.estado !== 'recusada') throw new Error('impossível');
    expect(resultado.origem).toBe('flag');
  });

  it('arquivo com base inválida é "recusada" com origem arquivo — outra disposição', () => {
    escrever(JSON.stringify({ base: join(projeto, 'dentro-do-projeto') }));

    const resultado = resolverBaseConsentida(undefined, home, null, opcoes());

    expect(resultado.estado).toBe('recusada');
    if (resultado.estado !== 'recusada') throw new Error('impossível');
    expect(resultado.origem).toBe('arquivo');
    expect(resultado.mensagem).toContain('base-dentro-da-raiz');
  });

  it('arquivo corrompido é recusa NOMEADA, e a mensagem diz o caminho do arquivo', () => {
    escrever('{ truncado');

    const resultado = resolverBaseConsentida(undefined, home, null, opcoes());

    expect(resultado.estado).toBe('recusada');
    if (resultado.estado !== 'recusada') throw new Error('impossível');
    expect(resultado.mensagem).toContain(caminhoDoArquivoDeBase(home, null));
  });

  it('nunca lança: uma base impossível vira estado, nunca exceção', () => {
    expect(() => resolverBaseConsentida('/', home, null, opcoes())).not.toThrow();
  });
});
