import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { FERRAMENTAS_CONHECIDAS, fraseDaFerramenta } from './narracao-de-ferramentas';
// Resolve pelo singleton REAL de `lib/i18n.ts` (`i18n.t(chave, {ns:
// 'toolNarration'})`) — as asserções abaixo checam o texto ATUAL em
// português, então o idioma precisa ser fixado antes de qualquer chamada
// (mesmo padrão de `session-falha.test.ts`/`agent-status.test.ts`).
import i18n from './i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('fraseDaFerramenta — cobertura das 19 ferramentas conhecidas', () => {
  it('a lista não veio vazia', () => {
    expect(FERRAMENTAS_CONHECIDAS.length).toBe(19);
  });

  it.each(FERRAMENTAS_CONHECIDAS)('%s tem frase própria, não o fallback', (tool) => {
    const frase = fraseDaFerramenta(tool);
    expect(frase).not.toContain(tool);
    expect(frase).not.toContain('Usando');
    expect(frase.length).toBeGreaterThan(5);
  });

  it('create_story narra escrever uma história', () => {
    expect(fraseDaFerramenta('create_story')).toBe('Escrevendo uma história');
  });

  it('ask_structured_questions é compartilhada entre Criativo e PO — uma frase só', () => {
    expect(fraseDaFerramenta('ask_structured_questions')).toBe('Preparando perguntas para você');
  });
});

describe('ferramenta desconhecida', () => {
  it('cai no fallback, nunca quebra', () => {
    const frase = fraseDaFerramenta('uma_ferramenta_que_nao_existe_ainda');
    expect(frase).toContain('uma_ferramenta_que_nao_existe_ainda');
    expect(frase).toContain('Usando');
  });

  it('confirm_readiness/confirm_architecture não são tool call — caem no fallback', () => {
    expect(fraseDaFerramenta('confirm_readiness')).toContain('Usando');
    expect(fraseDaFerramenta('confirm_architecture')).toContain('Usando');
  });
});

describe('em inglês', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('pt-BR');
  });

  it('create_story narra em inglês', () => {
    expect(fraseDaFerramenta('create_story')).toBe('Writing a story');
  });

  it('fallback também traduz', () => {
    expect(fraseDaFerramenta('tool_nova')).toContain('Using');
  });
});
