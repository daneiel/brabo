import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aplicar,
  estaEmPortugues,
  hashDoTexto,
  lerCatalogo,
  LOCALES_DA_API,
  medirApi,
  ROTULOS_DO_REDOC,
  rotulosFaltando,
  textosDaFonte,
} from './openapi-por-locale.mjs';

/** AT-565 (ADR 0220). Cada reprovação é a MUTAÇÃO de um caso certo. */

const spec = () => ({
  info: { title: 'Brabo', description: 'The API.' },
  paths: {
    '/x': {
      get: {
        summary: 'List `x` items',
        description: 'Lista os itens não arquivados.',
        tags: ['auth'],
        parameters: [{ name: 'id', description: 'The id' }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: { schemas: { X: { properties: { a: { description: 'Field a' } } } } },
});
const entrada = (fonte: string, traducao: string) => ({ [hashDoTexto(fonte)]: { fonte, traducao } });

describe('aplicar', () => {
  it('traduz operação, parâmetro, resposta, propriedade, info e o rótulo da tag', () => {
    const cat = {
      ...entrada('List `x` items', 'Lista os itens `x`'),
      ...entrada('The id', 'O id'),
      ...entrada('OK', 'Certo'),
      ...entrada('Field a', 'Campo a'),
      ...entrada('The API.', 'A API.'),
      ...entrada('auth', 'autenticação'),
    };
    const r = aplicar(spec(), cat);
    const op = r.spec.paths['/x'].get;
    expect(op.summary).toBe('Lista os itens `x`');
    expect(op.parameters[0].description).toBe('O id');
    expect(op.responses['200'].description).toBe('Certo');
    expect(r.spec.components.schemas.X.properties.a.description).toBe('Campo a');
    expect(r.spec.info.description).toBe('A API.');
    // o nome da tag fica (âncora `#tag/auth`); só o rótulo muda
    expect(op.tags).toEqual(['auth']);
    expect(r.spec.tags).toEqual([{ name: 'auth', 'x-displayName': 'autenticação' }]);
    expect(r.faltando).toEqual([hashDoTexto('Lista os itens não arquivados.')]);
    expect(r.orfas).toEqual([]);
  });

  it('mutação: entrada faltando cai no texto da fonte', () => {
    const r = aplicar(spec(), {});
    expect(r.spec.paths['/x'].get.summary).toBe('List `x` items');
    expect(r.faltando).toHaveLength(textosDaFonte(spec()).size);
  });

  it('mutação: hash que a spec não tem mais é órfã', () => {
    expect(aplicar(spec(), entrada('Texto que saiu da api', 'x')).orfas).toEqual([hashDoTexto('Texto que saiu da api')]);
  });

  it('mutação: tradução que perde um trecho de código é inválida e cai na fonte', () => {
    const r = aplicar(spec(), entrada('List `x` items', 'Lista os itens x'));
    expect(r.invalidas).toEqual([hashDoTexto('List `x` items')]);
    expect(r.spec.paths['/x'].get.summary).toBe('List `x` items');
  });

  it('mutação: fonte que não bate com o hash é inválida', () => {
    expect(aplicar(spec(), { [hashDoTexto('OK')]: { fonte: 'Ok', traducao: 'Certo' } }).invalidas).toHaveLength(1);
  });

  it('não altera a spec de entrada', () => {
    const s = spec();
    aplicar(s, entrada('OK', 'Certo'));
    expect(s.paths['/x'].get.responses['200'].description).toBe('OK');
  });
});

describe('medirApi', () => {
  it('o en só conta os textos em pt-BR; os demais locales contam todos', () => {
    const m = medirApi(spec(), { 'pt-BR': entrada('OK', 'Certo'), en: entrada('Lista os itens não arquivados.', 'Lists the items.') });
    const total = textosDaFonte(spec()).size;
    expect(m['pt-BR']).toEqual({ traduzidos: 1, total });
    expect(m.en).toEqual({ traduzidos: 1, total: 1 });
    expect(m.ru).toEqual({ traduzidos: 0, total });
  });

  it('heurística do pt-BR', () => {
    expect(estaEmPortugues('Projeto não encontrado.')).toBe(true);
    expect(estaEmPortugues('Lista os itens para o projeto')).toBe(true);
    expect(estaEmPortugues('Project not found.')).toBe(false);
  });
});

describe('rótulos do Redoc e catálogos commitados', () => {
  it('todo locale tem os 18 rótulos', () => {
    expect(Object.keys(ROTULOS_DO_REDOC.en)).toHaveLength(18);
    expect(rotulosFaltando(ROTULOS_DO_REDOC)).toEqual([]);
  });

  it('mutação: rótulo faltando num locale reprova', () => {
    const { download: _fora, ...ru } = ROTULOS_DO_REDOC.ru;
    expect(rotulosFaltando({ ...ROTULOS_DO_REDOC, ru })).toEqual(['ru.download']);
  });

  it('nenhum catálogo commitado tem órfã nem entrada inválida', () => {
    const raiz = join(import.meta.dirname, '../..');
    const real = JSON.parse(readFileSync(join(raiz, 'docs/reference/openapi.json'), 'utf8'));
    for (const l of LOCALES_DA_API) {
      const r = aplicar(real, lerCatalogo(raiz, l));
      expect([l, r.orfas, r.invalidas]).toEqual([l, [], []]);
    }
  });
});
