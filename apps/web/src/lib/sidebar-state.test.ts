import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoCollapseContext,
  CHAVE_ABA_ATIVA,
  CHAVE_AGENTES_ABERTOS,
  CHAVE_COLAPSADO,
  CHAVE_PROJETO_ATIVO,
  CHAVE_PROJETOS_ABERTOS,
  corDoProjeto,
  gravarAbaAtiva,
  gravarAgentesAbertos,
  gravarColapsado,
  gravarProjetoAtivo,
  gravarProjetosAbertos,
  lerAbaAtiva,
  lerAgentesAbertos,
  lerColapsado,
  lerProjetoAtivo,
  lerProjetosAbertos,
  useAutoCollapseSidebar,
} from './sidebar-state';

/**
 * Persistência da sidebar (PROGRAMA 28, Onda 2 — RN-195..201).
 *
 * As seis chaves são as do handoff, ao pé da letra
 * (`design_handoff_brabo/CHECKLIST-CONFRONTO.md`, seção 1) — os testes de
 * chave literal são o que impede uma delas de ser renomeada por engano numa
 * refatoração futura.
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sidebar-state — chaves exatas do handoff', () => {
  it('usa os literais documentados, não variações', () => {
    expect(CHAVE_COLAPSADO).toBe('brabo.sidebar.collapsed');
    expect(CHAVE_PROJETOS_ABERTOS).toBe('brabo.sidebar.open');
    expect(CHAVE_AGENTES_ABERTOS).toBe('brabo.sidebar.agents');
    expect(CHAVE_PROJETO_ATIVO).toBe('brabo.project');
    expect(CHAVE_ABA_ATIVA).toBe('brabo.tab');
  });
});

describe('colapso — caminho feliz', () => {
  it('sem nada gravado, começa expandido', () => {
    expect(lerColapsado()).toBe(false);
  });

  it('gravar e ler o mesmo valor, nos dois sentidos', () => {
    gravarColapsado(true);
    expect(lerColapsado()).toBe(true);
    expect(window.localStorage.getItem(CHAVE_COLAPSADO)).toBe('1');

    gravarColapsado(false);
    expect(lerColapsado()).toBe(false);
    expect(window.localStorage.getItem(CHAVE_COLAPSADO)).toBe('0');
  });
});

describe('conjuntos (projetos e agentes abertos) — caminho feliz', () => {
  it('sem nada gravado, conjunto vazio', () => {
    expect(lerProjetosAbertos()).toEqual(new Set());
    expect(lerAgentesAbertos()).toEqual(new Set());
  });

  it('gravar e reler preserva os ids, em qualquer ordem', () => {
    gravarProjetosAbertos(new Set(['p1', 'p2']));
    expect(lerProjetosAbertos()).toEqual(new Set(['p1', 'p2']));

    gravarAgentesAbertos(new Set(['dev-backend', 'dev-backend/dev-backend-2']));
    expect(lerAgentesAbertos()).toEqual(new Set(['dev-backend', 'dev-backend/dev-backend-2']));
  });
});

describe('conjuntos — quando dá errado', () => {
  it('JSON corrompido no localStorage degrada para conjunto vazio, não lança', () => {
    window.localStorage.setItem(CHAVE_PROJETOS_ABERTOS, '{not json');
    expect(() => lerProjetosAbertos()).not.toThrow();
    expect(lerProjetosAbertos()).toEqual(new Set());
  });

  it('valor que não é array (ex.: objeto) também degrada para vazio', () => {
    window.localStorage.setItem(CHAVE_AGENTES_ABERTOS, '{"a":1}');
    expect(lerAgentesAbertos()).toEqual(new Set());
  });

  it('localStorage que LANÇA não derruba leitura nem escrita', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });

    expect(() => gravarProjetosAbertos(new Set(['p1']))).not.toThrow();
    expect(lerProjetosAbertos()).toEqual(new Set());
    expect(lerColapsado()).toBe(false);
    expect(() => gravarColapsado(true)).not.toThrow();
  });
});

describe('projeto e aba ativos — caminho feliz', () => {
  it('sem nada gravado, null', () => {
    expect(lerProjetoAtivo()).toBeNull();
    expect(lerAbaAtiva()).toBeNull();
  });

  it('gravar e reler', () => {
    gravarProjetoAtivo('project-1');
    expect(lerProjetoAtivo()).toBe('project-1');

    gravarAbaAtiva('code');
    expect(lerAbaAtiva()).toBe('code');
  });
});

describe('corDoProjeto', () => {
  it('é estável — o MESMO id sempre devolve a MESMA cor', () => {
    expect(corDoProjeto('project-abc')).toBe(corDoProjeto('project-abc'));
  });

  it('ids diferentes tendem a cores diferentes (paleta com mais de uma cor)', () => {
    const cores = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(corDoProjeto));
    // Não é garantia de bijeção (hash pode colidir) — só que a função não
    // devolve a MESMA cor sempre, o que tornaria a "identidade" inútil.
    expect(cores.size).toBeGreaterThan(1);
  });

  it('sempre devolve um token CSS var(--...)', () => {
    expect(corDoProjeto('qualquer-id')).toMatch(/^var\(--[\w-]+\)$/);
  });
});

/**
 * Auto-collapse (RN-201): o hook chama `registrar(true)` ao montar e
 * `registrar(false)` ao desmontar — é essa dança que faz o Shell voltar ao
 * estado anterior quando a aba de Código some, sem gravar nada em
 * `localStorage`.
 */
describe('useAutoCollapseSidebar', () => {
  function Consumidor({ ativo }: { ativo?: boolean }) {
    useAutoCollapseSidebar(ativo);
    return null;
  }

  it('registra true ao montar e false ao desmontar', () => {
    const chamadas: boolean[] = [];
    const valor = { registrar: (v: boolean) => chamadas.push(v) };

    const { unmount } = render(
      createElement(AutoCollapseContext.Provider, { value: valor }, createElement(Consumidor)),
    );

    expect(chamadas).toEqual([true]);
    unmount();
    expect(chamadas).toEqual([true, false]);
  });

  it('fora de um Provider (Shell ausente) é NO-OP — nunca lança', () => {
    expect(() => render(createElement(Consumidor))).not.toThrow();
  });

  it('ativo=false nunca registra nada', () => {
    const chamadas: boolean[] = [];
    const valor = { registrar: (v: boolean) => chamadas.push(v) };

    render(
      createElement(AutoCollapseContext.Provider, { value: valor }, createElement(Consumidor, { ativo: false })),
    );

    expect(chamadas).toEqual([]);
  });
});
