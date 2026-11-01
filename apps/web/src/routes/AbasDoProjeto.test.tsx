import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { AbasDoProjeto, itensDasAbas, type ItemDaLista } from './AbasDoProjeto';
import shellPtBR from '../locales/pt-BR/shell.json';
import { simularLayoutMovel } from '../test/match-media';
import type { ContagensDeAba } from './project-tabs';

/**
 * Instância REAL de i18next, própria do teste (mesmo padrão de
 * `Shell.test.tsx`): `AbasDoProjeto` usa `useTranslation('shell')` só para o
 * `aria-label` do trilho — sem recursos, `t()` devolveria a própria chave.
 * Os RÓTULOS das abas não passam por aqui: vêm prontos nos `itens`, resolvidos
 * por quem monta a lista (`itensDasAbas`, contra `project-tabs.ts`).
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { shell: shellPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'shell',
    ns: ['shell'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

/** A mesma FORMA que `GRUPOS_DO_PROJETO` entrega — solta, três grupos, soltas. */
const ITENS: ItemDaLista[] = [
  { tipo: 'aba', aba: { key: 'overview', label: 'Visão geral' } },
  {
    tipo: 'grupo',
    chave: 'agentes',
    label: 'Agentes',
    abas: [
      { key: 'executores', label: 'Executores' },
      { key: 'criativo', label: 'Criativo' },
      { key: 'chat', label: 'Chat' },
      { key: 'insights', label: 'Insights', count: 2 },
    ],
  },
  {
    tipo: 'grupo',
    chave: 'dev',
    label: 'Dev',
    abas: [
      { key: 'code', label: 'Código' },
      { key: 'prs', label: 'PRs', count: 1 },
      { key: 'approvals', label: 'Aprovações', count: 3 },
    ],
  },
  {
    tipo: 'grupo',
    chave: 'documentacao',
    label: 'Documentação',
    abas: [
      { key: 'backlog', label: 'Backlog', count: 4 },
      { key: 'arquitetura', label: 'Arquitetura', count: 5 },
    ],
  },
  { tipo: 'aba', aba: { key: 'spend', label: 'Gastos' } },
  { tipo: 'aba', aba: { key: 'settings', label: 'Configurações' } },
];

const ORDEM_ACHATADA = [
  'Visão geral',
  'Executores',
  'Criativo',
  'Chat',
  'Insights',
  'Código',
  'PRs',
  'Aprovações',
  'Backlog',
  'Arquitetura',
  'Gastos',
  'Configurações',
];

/** `AbasDoProjeto` é totalmente controlado — este wrapper é o dono do estado,
 * o mesmo papel que o `Shell` cumpre de verdade. */
function Controlado({
  inicial,
  itens = ITENS,
}: {
  inicial: string;
  itens?: ItemDaLista[];
}) {
  const [active, setActive] = useState(inicial);
  return (
    <I18nextProvider i18n={novaInstanciaI18n()}>
      <AbasDoProjeto projectId="p-1" nomeDoProjeto="Checkout" itens={itens} active={active} onChange={setActive} />
    </I18nextProvider>
  );
}

describe('AbasDoProjeto — os três grupos ficam abertos ao mesmo tempo', () => {
  it('as 12 abas aparecem juntas, na ordem declarada — nunca só o nível de topo', () => {
    render(<Controlado inicial="overview" />);

    const abas = screen.getAllByRole('tab');
    expect(abas.map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(ORDEM_ACHATADA);
  });

  it('os cabeçalhos dos três grupos aparecem, e NENHUM deles é selecionável', () => {
    render(<Controlado inicial="overview" />);

    for (const grupo of ['Agentes', 'Dev', 'Documentação']) {
      expect(screen.getByText(grupo)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: grupo })).toBeNull();
    }
  });

  it('a lista é um tablist VERTICAL, e as 12 abas são filhas diretas dele', () => {
    render(<Controlado inicial="overview" />);

    const lista = screen.getByRole('tablist');
    expect(lista).toHaveAttribute('aria-orientation', 'vertical');
    expect(lista).toHaveAccessibleName('Abas de Checkout');
    expect(within(lista).getAllByRole('tab')).toHaveLength(12);
  });
});

describe('AbasDoProjeto — a aba ativa e a troca de aba', () => {
  it('só a aba ativa é marcada, e clicar noutra move a marca', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    const marcadas = () =>
      screen
        .getAllByRole('tab')
        .filter((b) => b.getAttribute('aria-selected') === 'true')
        .map((b) => b.textContent);
    expect(marcadas()).toEqual(['Visão geral']);

    await usuario.click(screen.getByRole('tab', { name: 'Código' }));

    expect(marcadas()).toEqual(['Código']);
  });

  it('deep-link: montar com `active` dentro de um grupo já marca a filha certa, sem abrir nada', () => {
    render(<Controlado inicial="arquitetura" />);

    expect(
      screen.getByRole('tab', { name: /^Arquitetura\s*5$/ }).getAttribute('aria-selected'),
    ).toBe('true');
    // O trilho não tem "grupo aberto": as outras continuam todas visíveis.
    expect(screen.getByRole('tab', { name: 'Criativo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Código' })).toBeInTheDocument();
  });
});

/**
 * Os cinco contadores ficam SEPARADOS (decisão de produto — somá-los esconde
 * qual fila está pedindo atenção), e o grupo NÃO soma os filhos.
 */
describe('AbasDoProjeto — os cinco contadores', () => {
  it('cada fila mostra o próprio número, e nenhum grupo mostra soma', () => {
    render(<Controlado inicial="overview" />);

    expect(screen.getByRole('tab', { name: /^Insights\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^PRs\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Aprovações\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Backlog\s*4$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Arquitetura\s*5$/ })).toBeInTheDocument();

    // "Dev" somaria 4 (PRs 1 + Aprovações 3) na régua antiga. Aqui o
    // cabeçalho é só o nome do grupo — nenhum número junto dele.
    expect(screen.getByText('Dev').textContent).toBe('Dev');
    expect(screen.getByText('Documentação').textContent).toBe('Documentação');
  });

  it('aba sem contador não ganha selo — zero pendência não é informação', () => {
    render(
      <Controlado
        inicial="overview"
        itens={[
          { tipo: 'aba', aba: { key: 'overview', label: 'Visão geral' } },
          {
            tipo: 'grupo',
            chave: 'dev',
            label: 'Dev',
            abas: [
              { key: 'code', label: 'Código' },
              { key: 'approvals', label: 'Aprovações', count: 0 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Código' }).textContent).toBe('Código');
    // Fila vazia (`count: 0`) também não ganha selo (ADR 0211).
    expect(screen.getByRole('tab', { name: 'Aprovações' }).textContent).toBe('Aprovações');
  });
});

/**
 * O contrato de teclado portado da régua horizontal que este trilho substituiu
 * (`GroupedTabs.tsx`, `onKeyDownDaLinha`, removida na mesma mudança), com o
 * eixo trocado: `ArrowDown`/`ArrowUp` no lugar de `ArrowRight`/`ArrowLeft`.
 */
describe('AbasDoProjeto — navegação por teclado', () => {
  it('ArrowDown avança um item, atravessando a fronteira de grupo', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    screen.getByRole('tab', { name: 'Visão geral' }).focus();
    await usuario.keyboard('{ArrowDown}');

    // "Visão geral" é solta; o próximo é a PRIMEIRA filha de "Agentes".
    const executores = screen.getByRole('tab', { name: 'Executores' });
    expect(document.activeElement).toBe(executores);
    expect(executores.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp volta um item', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="criativo" />);

    screen.getByRole('tab', { name: 'Criativo' }).focus();
    await usuario.keyboard('{ArrowUp}');

    const executores = screen.getByRole('tab', { name: 'Executores' });
    expect(document.activeElement).toBe(executores);
    expect(executores.getAttribute('aria-selected')).toBe('true');
  });

  it('do último item, ArrowDown dá a volta pro primeiro (wrap)', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="settings" />);

    screen.getByRole('tab', { name: 'Configurações' }).focus();
    await usuario.keyboard('{ArrowDown}');

    const primeiro = screen.getByRole('tab', { name: 'Visão geral' });
    expect(document.activeElement).toBe(primeiro);
    expect(primeiro.getAttribute('aria-selected')).toBe('true');
  });

  it('do primeiro item, ArrowUp dá a volta pro último (wrap)', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    screen.getByRole('tab', { name: 'Visão geral' }).focus();
    await usuario.keyboard('{ArrowUp}');

    const ultimo = screen.getByRole('tab', { name: 'Configurações' });
    expect(document.activeElement).toBe(ultimo);
    expect(ultimo.getAttribute('aria-selected')).toBe('true');
  });

  it('Home vai para a primeira aba e End para a última, de onde quer que se esteja', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="code" />);

    screen.getByRole('tab', { name: 'Código' }).focus();
    await usuario.keyboard('{End}');

    const ultimo = screen.getByRole('tab', { name: 'Configurações' });
    expect(document.activeElement).toBe(ultimo);
    expect(ultimo.getAttribute('aria-selected')).toBe('true');

    await usuario.keyboard('{Home}');

    const primeiro = screen.getByRole('tab', { name: 'Visão geral' });
    expect(document.activeElement).toBe(primeiro);
    expect(primeiro.getAttribute('aria-selected')).toBe('true');
  });

  it('tecla que não é de navegação não mexe em nada', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    const visaoGeral = screen.getByRole('tab', { name: 'Visão geral' });
    visaoGeral.focus();
    await usuario.keyboard('{ArrowRight}');

    expect(document.activeElement).toBe(visaoGeral);
    expect(visaoGeral.getAttribute('aria-selected')).toBe('true');
  });
});

/** ADR 0211: o que mudou ao sair do trilho e entrar na sidebar. */
describe('AbasDoProjeto — dentro da sidebar (ADR 0211)', () => {
  it('cada aba é link para o PROJETO dela, não um `?tab=` relativo à página atual', () => {
    render(<Controlado inicial="overview" />);
    expect(screen.getByRole('tab', { name: 'Código' })).toHaveAttribute(
      'href',
      '/projects/p-1?tab=code',
    );
  });

  it('roving tabindex: só a ativa entra no Tab; sem ativa, a primeira', () => {
    const { unmount } = render(<Controlado inicial="code" />);
    const paradas = () =>
      screen.getAllByRole('tab').filter((a) => a.getAttribute('tabindex') === '0');
    expect(paradas().map((a) => a.textContent)).toEqual(['Código']);
    unmount();

    render(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <AbasDoProjeto projectId="p-1" nomeDoProjeto="Checkout" itens={ITENS} active={undefined} onChange={() => {}} />
      </I18nextProvider>,
    );
    expect(paradas().map((a) => a.textContent)).toEqual(['Visão geral']);
    expect(
      screen.getAllByRole('tab').filter((a) => a.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(0);
  });

  it('no telefone continua VERTICAL: a lista mora na gaveta, não vira barra (RN-643)', () => {
    const largura = simularLayoutMovel(true);
    try {
      render(<Controlado inicial="overview" />);
      expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
      expect(screen.getAllByRole('tab')).toHaveLength(12);
    } finally {
      largura.restaurar();
    }
  });

  it('clique com Ctrl deixa o navegador abrir o link noutra aba — não troca no lugar', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <AbasDoProjeto projectId="p-1" nomeDoProjeto="Checkout" itens={ITENS} active="overview" onChange={onChange} />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Código' }), { ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Código' }));
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('itensDasAbas: com contagens, cada fila no SEU número; sem, nenhuma', () => {
    const contagens: ContagensDeAba = {
      promocoesPendentes: 4,
      aprovacoesPendentes: 3,
      hipotesesPendentes: 2,
      prsPendentes: 1,
      arquiteturaPendente: 5,
    };
    const folhas = (itens: ItemDaLista[]) =>
      itens.flatMap((i) => (i.tipo === 'grupo' ? i.abas : [i.aba]));
    const comNumero = folhas(itensDasAbas(contagens)).filter((f) => f.count);
    expect(comNumero.map((f) => [f.key, f.count])).toEqual([
      ['insights', 2],
      ['prs', 1],
      ['approvals', 3],
      ['backlog', 4],
      ['arquitetura', 5],
    ]);
    expect(folhas(itensDasAbas(undefined)).every((f) => f.count === undefined)).toBe(true);
  });
});
