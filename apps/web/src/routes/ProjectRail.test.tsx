import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { ProjectRail, type ItemDoTrilho } from './ProjectRail';
import navPtBR from '../locales/pt-BR/nav.json';
import { simularLayoutMovel } from '../test/match-media';

/**
 * Instância REAL de i18next, própria do teste (mesmo padrão de
 * `Shell.test.tsx`): `ProjectRail` usa `useTranslation('nav')` só para o
 * `aria-label` do trilho — sem recursos, `t()` devolveria a própria chave.
 * Os RÓTULOS das abas não passam por aqui: vêm prontos nos `itens`, resolvidos
 * por quem monta a lista (`ProjectPage`, contra `project-tabs.ts`).
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { nav: navPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'nav',
    ns: ['nav'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

/** A mesma FORMA que `GRUPOS_DO_PROJETO` entrega — solta, três grupos, soltas. */
const ITENS: ItemDoTrilho[] = [
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

/** `ProjectRail` é totalmente controlado — este wrapper é o dono do estado,
 * o mesmo papel que `ProjectPage` cumpre de verdade. */
function Controlado({
  inicial,
  itens = ITENS,
}: {
  inicial: string;
  itens?: ItemDoTrilho[];
}) {
  const [active, setActive] = useState(inicial);
  return (
    <I18nextProvider i18n={novaInstanciaI18n()}>
      <ProjectRail itens={itens} active={active} onChange={setActive} />
    </I18nextProvider>
  );
}

describe('ProjectRail — os três grupos ficam abertos ao mesmo tempo', () => {
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
    expect(lista).toHaveAccessibleName('Abas do projeto');
    expect(within(lista).getAllByRole('tab')).toHaveLength(12);
  });
});

describe('ProjectRail — a aba ativa e a troca de aba', () => {
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
describe('ProjectRail — os cinco contadores', () => {
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
    // `count: 0` chega até aqui só se quem monta a lista deixar — `ProjectPage`
    // devolve `undefined` nesse caso —, mas quando chega o selo aparece: quem
    // decide o que é ruído é o registro, não o trilho.
    expect(screen.getByRole('tab', { name: /^Aprovações\s*0$/ })).toBeInTheDocument();
  });
});

/**
 * O contrato de teclado portado da régua horizontal que este trilho substituiu
 * (`GroupedTabs.tsx`, `onKeyDownDaLinha`, removida na mesma mudança), com o
 * eixo trocado: `ArrowDown`/`ArrowUp` no lugar de `ArrowRight`/`ArrowLeft`.
 */
describe('ProjectRail — navegação por teclado', () => {
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

/**
 * RN-643 (AT-316): abaixo do breakpoint móvel o trilho vira BARRA horizontal
 * rolável — as mesmas 12 folhas, o eixo do teclado girado junto.
 */
describe('ProjectRail — barra horizontal no layout móvel (RN-643)', () => {
  let largura: ReturnType<typeof simularLayoutMovel> | null = null;
  afterEach(() => {
    largura?.restaurar();
    largura = null;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('vira tablist HORIZONTAL com as 12 abas na mesma ordem, e traz a ativa para a faixa visível', () => {
    largura = simularLayoutMovel(true);
    const rolar = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = rolar;

    render(<Controlado inicial="settings" />);

    const lista = screen.getByRole('tablist');
    expect(lista).toHaveAttribute('aria-orientation', 'horizontal');
    const abas = within(lista).getAllByRole('tab');
    expect(abas.map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(ORDEM_ACHATADA);
    expect(rolar).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(rolar.mock.contexts[0]).toBe(screen.getByRole('tab', { name: 'Configurações' }));
  });

  it('as setas esquerda/direita andam, com volta; a seta para baixo não faz nada ali', async () => {
    largura = simularLayoutMovel(true);
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    screen.getByRole('tab', { name: 'Visão geral' }).focus();
    await usuario.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Executores' })).toHaveAttribute('aria-selected', 'true');

    await usuario.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Executores' })).toHaveAttribute('aria-selected', 'true');

    await usuario.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Configurações' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sem matchMedia (desktop) continua o trilho VERTICAL, e a seta direita não anda', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    screen.getByRole('tab', { name: 'Visão geral' }).focus();
    await usuario.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
  });
});

/**
 * AT-330 (achado N8 da auditoria da Rodada 29): em 390px a aba ativa nascia
 * cortada ("Config…") — os contadores chegam depois e empurram a ativa para
 * fora — e nada dizia que a faixa rola.
 */
describe('ProjectRail — a faixa móvel acompanha a ativa e diz que rola (AT-330)', () => {
  let largura: ReturnType<typeof simularLayoutMovel> | null = null;
  afterEach(() => {
    largura?.restaurar();
    largura = null;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  /** Dá à faixa as medidas que o jsdom não calcula. */
  function medidas(el: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  }

  it('um contador que chega depois traz a aba ativa de volta para a faixa', () => {
    largura = simularLayoutMovel(true);
    const rolar = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = rolar;
    const semContador = ITENS.map((item) =>
      item.tipo === 'grupo'
        ? { ...item, abas: item.abas.map(({ count: _c, ...aba }) => aba) }
        : item,
    );

    const tela = render(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <ProjectRail itens={semContador} active="settings" onChange={() => {}} />
      </I18nextProvider>,
    );
    const chamadasAntes = rolar.mock.calls.length;

    tela.rerender(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <ProjectRail itens={ITENS} active="settings" onChange={() => {}} />
      </I18nextProvider>,
    );

    expect(rolar.mock.calls.length).toBeGreaterThan(chamadasAntes);
    expect(rolar.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'Configurações' }));

    // Re-render com o MESMO conteúdo (array novo, mesmas abas) não rola de
    // novo: quem rolou a faixa à mão não é puxado de volta a cada render.
    const chamadasDepois = rolar.mock.calls.length;
    tela.rerender(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <ProjectRail itens={[...ITENS]} active="settings" onChange={() => {}} />
      </I18nextProvider>,
    );
    expect(rolar.mock.calls.length).toBe(chamadasDepois);
  });

  it('a borda com conteúdo escondido é marcada, e a marca acompanha a rolagem', () => {
    largura = simularLayoutMovel(true);
    render(<Controlado inicial="overview" />);
    const faixa = screen.getByRole('tablist');
    medidas(faixa, { scrollWidth: 900, clientWidth: 390 });

    act(() => {
      faixa.scrollLeft = 0;
      fireEvent.scroll(faixa);
    });
    expect(faixa).toHaveAttribute('data-rola-fim');
    expect(faixa).not.toHaveAttribute('data-rola-inicio');

    act(() => {
      faixa.scrollLeft = 200;
      fireEvent.scroll(faixa);
    });
    expect(faixa).toHaveAttribute('data-rola-fim');
    expect(faixa).toHaveAttribute('data-rola-inicio');

    act(() => {
      faixa.scrollLeft = 510;
      fireEvent.scroll(faixa);
    });
    expect(faixa).not.toHaveAttribute('data-rola-fim');
    expect(faixa).toHaveAttribute('data-rola-inicio');
  });

  it('caso de falha: faixa que cabe inteira não esmaece nada — nem no desktop', () => {
    largura = simularLayoutMovel(true);
    render(<Controlado inicial="overview" />);
    const faixa = screen.getByRole('tablist');
    medidas(faixa, { scrollWidth: 390, clientWidth: 390 });
    act(() => {
      fireEvent.scroll(faixa);
    });
    expect(faixa).not.toHaveAttribute('data-rola-fim');
    expect(faixa).not.toHaveAttribute('data-rola-inicio');

    act(() => largura!.mudar(false));
    expect(screen.getByRole('tablist')).not.toHaveAttribute('data-rola-fim');
  });
});
