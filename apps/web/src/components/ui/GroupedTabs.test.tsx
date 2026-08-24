import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupedTabs, type ItemDeRegua } from './GroupedTabs';

const ITENS: ItemDeRegua[] = [
  { tipo: 'aba', aba: { key: 'overview', label: 'Visão geral' } },
  {
    tipo: 'grupo',
    chave: 'agentes',
    label: 'Agentes',
    abas: [
      { key: 'executores', label: 'Executores' },
      { key: 'criativo', label: 'Criativo' },
      { key: 'chat', label: 'Chat' },
    ],
  },
  {
    tipo: 'grupo',
    chave: 'dev',
    label: 'Dev',
    abas: [
      { key: 'code', label: 'Código' },
      { key: 'approvals', label: 'Aprovações' },
    ],
  },
  { tipo: 'aba', aba: { key: 'settings', label: 'Configurações' } },
];

/** `GroupedTabs` é totalmente controlado — este wrapper é o dono do estado,
 * o mesmo papel que `ProjectPage` cumpre de verdade. */
function Controlado({ inicial }: { inicial: string }) {
  const [active, setActive] = useState(inicial);
  return <GroupedTabs itens={ITENS} active={active} onChange={setActive} />;
}

describe('GroupedTabs', () => {
  it('abas soltas e grupos aparecem no topo; nenhuma filha aparece antes de o grupo ser escolhido', async () => {
    render(<Controlado inicial="overview" />);

    const topo = await screen.findAllByRole('tab');
    expect(topo.map((b) => b.textContent)).toEqual([
      'Visão geral',
      'Agentes',
      'Dev',
      'Configurações',
    ]);
    expect(screen.queryByRole('tab', { name: 'Executores' })).toBeNull();
  });

  it('clicar num grupo revela a segunda linha e seleciona a PRIMEIRA filha, quando nenhuma foi visitada ainda', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    await usuario.click(screen.getByRole('tab', { name: 'Agentes' }));

    const executores = await screen.findByRole('tab', { name: 'Executores' });
    expect(executores.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Criativo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    // O grupo em si também aparece selecionado no topo.
    expect(screen.getByRole('tab', { name: 'Agentes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('deep-link: montar já com `active` dentro de um grupo abre o grupo expandido, com a filha certa marcada', async () => {
    render(<Controlado inicial="criativo" />);

    const grupoAgentes = await screen.findByRole('tab', { name: 'Agentes' });
    expect(grupoAgentes.getAttribute('aria-selected')).toBe('true');

    const criativo = screen.getByRole('tab', { name: 'Criativo' });
    expect(criativo.getAttribute('aria-selected')).toBe('true');
    // As outras filhas do MESMO grupo também estão visíveis (a linha existe).
    expect(screen.getByRole('tab', { name: 'Executores' })).toBeInTheDocument();
    // Mas o outro grupo não abriu.
    expect(screen.queryByRole('tab', { name: 'Código' })).toBeNull();
  });

  it('lembra a última filha ativa por grupo — reabrir mostra ela, não a primeira', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    // Abre "Agentes" (vai para Executores, a primeira) e troca para Chat.
    await usuario.click(screen.getByRole('tab', { name: 'Agentes' }));
    await usuario.click(await screen.findByRole('tab', { name: 'Chat' }));
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');

    // Sai para outro grupo.
    await usuario.click(screen.getByRole('tab', { name: 'Dev' }));
    expect(await screen.findByRole('tab', { name: 'Código' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Chat' })).toBeNull();

    // Volta para "Agentes": deve reabrir em Chat, a última visitada — não em Executores.
    await usuario.click(screen.getByRole('tab', { name: 'Agentes' }));
    const chat = await screen.findByRole('tab', { name: 'Chat' });
    expect(chat.getAttribute('aria-selected')).toBe('true');
  });

  it('navegação por seta funciona na linha de TOPO — ArrowRight avança, com wrap', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="overview" />);

    screen.getByRole('tab', { name: 'Visão geral' }).focus();
    await usuario.keyboard('{ArrowRight}');

    // Avançou para o grupo "Agentes" — que, ao ser selecionado por teclado,
    // abre na primeira filha (mesma regra do clique).
    const agentes = screen.getByRole('tab', { name: 'Agentes' });
    expect(document.activeElement).toBe(agentes);
    expect(agentes.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('tab', { name: 'Executores' })).toBeInTheDocument();

    // Do último item (Configurações), ArrowRight dá a volta pro primeiro.
    screen.getByRole('tab', { name: 'Configurações' }).focus();
    await usuario.keyboard('{ArrowRight}');
    const visaoGeral = screen.getByRole('tab', { name: 'Visão geral' });
    expect(document.activeElement).toBe(visaoGeral);
    expect(visaoGeral.getAttribute('aria-selected')).toBe('true');
  });

  it('navegação por seta funciona na segunda linha (as filhas do grupo aberto)', async () => {
    const usuario = userEvent.setup();
    render(<Controlado inicial="executores" />);

    screen.getByRole('tab', { name: 'Executores' }).focus();
    await usuario.keyboard('{ArrowRight}');

    const criativo = screen.getByRole('tab', { name: 'Criativo' });
    expect(document.activeElement).toBe(criativo);
    expect(criativo.getAttribute('aria-selected')).toBe('true');

    await usuario.keyboard('{ArrowLeft}');
    const executores = screen.getByRole('tab', { name: 'Executores' });
    expect(document.activeElement).toBe(executores);
    expect(executores.getAttribute('aria-selected')).toBe('true');
  });

  it('o selo do grupo é a soma das filhas, e some quando a soma é zero', () => {
    const itensComContagem: ItemDeRegua[] = [
      { tipo: 'aba', aba: { key: 'overview', label: 'Visão geral' } },
      {
        tipo: 'grupo',
        chave: 'dev',
        label: 'Dev',
        abas: [
          { key: 'code', label: 'Código' },
          { key: 'approvals', label: 'Aprovações', count: 3 },
        ],
      },
      {
        tipo: 'grupo',
        chave: 'documentacao',
        label: 'Documentação',
        abas: [
          { key: 'backlog', label: 'Backlog' },
          { key: 'arquitetura', label: 'Arquitetura' },
        ],
      },
    ];

    render(<GroupedTabs itens={itensComContagem} active="overview" onChange={() => {}} />);

    expect(screen.getByRole('tab', { name: /^Dev\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Documentação' })).toBeInTheDocument();
  });
});
