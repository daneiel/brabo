import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ATRIBUTO_TEMA,
  CHAVE_TEMA,
  TEMA_PADRAO,
  alternarTema,
  aplicarTema,
  lerTemaSalvo,
  observarTema,
  temaAtual,
} from './tema';

/**
 * A preferência de tema (RN-182/RN-183, ADR 0074).
 *
 * O que este arquivo cobre além do óbvio: os dois caminhos de FALHA que
 * derrubariam o boot da app se não fossem contidos — `localStorage` que lança
 * e valor gravado que não é tema — e o CONTRATO com
 * `public/theme-boot.js`, que é o único lugar do produto que não passa por
 * este módulo (roda antes do bundle) e por isso é o único que pode divergir em
 * silêncio.
 */

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(ATRIBUTO_TEMA);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preferência de tema — o caminho feliz', () => {
  it('sem nada gravado, o tema é o padrão e não há preferência', () => {
    expect(lerTemaSalvo()).toBeNull();
    expect(temaAtual()).toBe(TEMA_PADRAO);
  });

  it('aplicar pinta o <html> e persiste a escolha', () => {
    expect(aplicarTema('light')).toBe('light');
    expect(document.documentElement.getAttribute(ATRIBUTO_TEMA)).toBe('light');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe('light');
    expect(lerTemaSalvo()).toBe('light');
    expect(temaAtual()).toBe('light');
  });

  it('alternar vai e volta, devolvendo sempre o tema NOVO', () => {
    expect(alternarTema()).toBe('light');
    expect(temaAtual()).toBe('light');
    expect(alternarTema()).toBe('dark');
    expect(temaAtual()).toBe('dark');
  });

  it('o atributo do <html> vence o localStorage — é o que a tela mostra', () => {
    window.localStorage.setItem(CHAVE_TEMA, 'dark');
    document.documentElement.setAttribute(ATRIBUTO_TEMA, 'light');
    expect(temaAtual()).toBe('light');
  });

  it('observar recebe a mudança e o cancelamento para de receber', () => {
    const visto: string[] = [];
    const cancelar = observarTema((t) => visto.push(t));

    aplicarTema('light');
    expect(visto).toEqual(['light']);

    cancelar();
    aplicarTema('dark');
    expect(visto).toEqual(['light']);
  });

  it('mudança em OUTRA aba chega pelo evento storage', () => {
    const visto: string[] = [];
    const cancelar = observarTema((t) => visto.push(t));

    window.dispatchEvent(
      new StorageEvent('storage', { key: CHAVE_TEMA, newValue: 'light' }),
    );

    expect(visto).toEqual(['light']);
    expect(document.documentElement.getAttribute(ATRIBUTO_TEMA)).toBe('light');
    cancelar();
  });

  it('evento storage de OUTRA chave é ignorado', () => {
    const visto: string[] = [];
    const cancelar = observarTema((t) => visto.push(t));

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'outra.coisa', newValue: 'light' }),
    );

    expect(visto).toEqual([]);
    cancelar();
  });
});

describe('preferência de tema — quando dá errado', () => {
  it('valor desconhecido no localStorage cai no padrão, não vira data-theme inválido', () => {
    window.localStorage.setItem(CHAVE_TEMA, 'solarizado');
    expect(lerTemaSalvo()).toBeNull();
    expect(temaAtual()).toBe(TEMA_PADRAO);
  });

  it('atributo desconhecido no <html> cai no que está gravado', () => {
    window.localStorage.setItem(CHAVE_TEMA, 'light');
    document.documentElement.setAttribute(ATRIBUTO_TEMA, 'sepia');
    expect(temaAtual()).toBe('light');
  });

  it('localStorage que LANÇA não derruba a leitura nem a escrita', () => {
    // Modo privado, storage bloqueado em iframe, cota estourada: o acesso
    // lança em vez de devolver null. Tema é preferência, não função — falhar
    // aqui não pode impedir a app de subir nem o usuário de trocar de tema.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });

    expect(lerTemaSalvo()).toBeNull();
    expect(temaAtual()).toBe(TEMA_PADRAO);
    expect(() => aplicarTema('light')).not.toThrow();
    // Degrada para "pinta e não persiste": a tela obedece.
    expect(document.documentElement.getAttribute(ATRIBUTO_TEMA)).toBe('light');
  });

  it('storage de outra aba com valor inválido cai no padrão em vez de propagar lixo', () => {
    const visto: string[] = [];
    const cancelar = observarTema((t) => visto.push(t));

    window.dispatchEvent(
      new StorageEvent('storage', { key: CHAVE_TEMA, newValue: 'nada-disso' }),
    );

    expect(visto).toEqual([TEMA_PADRAO]);
    cancelar();
  });
});

/**
 * `public/theme-boot.js` roda ANTES do bundle e por isso não pode importar
 * nada daqui. A chave e o default ficam escritos nos dois lugares, e este
 * bloco é o que impede os dois de divergirem — é a única forma de o produto
 * gravar numa chave e ler de outra.
 */
describe('contrato com o script de boot', () => {
  const boot = readFileSync(
    resolve(process.cwd(), 'public/theme-boot.js'),
    'utf8',
  );

  it('o boot usa a MESMA chave de localStorage', () => {
    expect(boot).toContain(`var CHAVE = '${CHAVE_TEMA}'`);
  });

  it('o boot usa o MESMO tema padrão', () => {
    expect(boot).toContain(`var PADRAO = '${TEMA_PADRAO}'`);
  });

  it('o boot escreve o MESMO atributo que os tokens observam', () => {
    expect(boot).toContain(`setAttribute('${ATRIBUTO_TEMA}', tema)`);
  });

  it('o boot é ES5 puro — o public/ do vite não passa por build', () => {
    const codigo = boot.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/\b(import|export|const|let|class)\b/);
    expect(codigo).not.toContain('=>');
  });
});
