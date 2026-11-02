import { describe, expect, it } from 'vitest';
import en from '../locales/en/models.json';
import ptBR from '../locales/pt-BR/models.json';

/**
 * A ajuda da faceta "thinking" nomeia quem roda sem raciocínio: os dev agents
 * de execução (RN-783) e o QA de Automação (RN-838, AT-508).
 */
type Arvore = { [k: string]: unknown };
function ajuda(arvore: Arvore): string {
  const achar = (n: unknown): string | undefined => {
    if (!n || typeof n !== 'object') return undefined;
    const o = n as Arvore;
    const r = o['reasoning'] as Arvore | undefined;
    if (r && typeof r['help'] === 'string') return r['help'];
    for (const v of Object.values(o)) {
      const a = achar(v);
      if (a) return a;
    }
    return undefined;
  };
  return achar(arvore) ?? '';
}

describe('ajuda da faceta thinking', () => {
  it('cita os dev agents de execução e o QA de automação nos dois idiomas', () => {
    expect(ajuda(en as Arvore)).toMatch(/dev agents.*automation QA/);
    expect(ajuda(ptBR as Arvore)).toMatch(/dev agents.*QA de automação/);
  });

  it('não afirma que só os dev agents rodam sem raciocínio', () => {
    expect(ajuda(en as Arvore)).not.toMatch(/Execution dev agents run with/);
    expect(ajuda(ptBR as Arvore)).not.toMatch(/execução o raciocínio/);
  });
});
