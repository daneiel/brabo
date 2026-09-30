import { afterEach, describe, it, expect } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { Table } from './Table';
import { simularLayoutMovel } from '../../test/match-media';

/**
 * Auditoria de foco visível (frente H1, PROGRAMA 28): `Table` foi um dos 5
 * arquivos sem `:focus-visible` encontrados no confronto de design. A causa
 * NÃO era ausência de estilo — é que o componente não expõe NENHUMA
 * afordância interativa própria: linha e célula são `<div>`, sem `onClick`,
 * sem `tabIndex`. Quem precisa de linha clicável coloca um `<button>`/`<a>`
 * DENTRO da célula via `render` — e aí o foco visível é do botão, não da
 * linha. Este teste é a guarda: se algum dia uma linha ganhar `onClick` sem
 * virar elemento focável, é aqui que o defeito aparece.
 */
describe('Table', () => {
  it('é apresentação pura — nenhuma linha expõe papel ou foco interativo próprio', () => {
    render(
      <Table
        columns={[{ key: 'nome', label: 'Nome', render: (r: { nome: string }) => r.nome }]}
        rows={[{ nome: 'Item 1' }, { nome: 'Item 2' }]}
        rowKey={(r) => r.nome}
      />,
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('interação de linha vem de dentro da célula — o render pode devolver um botão focável', () => {
    render(
      <Table
        columns={[
          { key: 'nome', label: 'Nome', render: (r: { nome: string }) => r.nome },
          {
            key: 'acao',
            label: '',
            render: (r: { nome: string }) => <button type="button">Abrir {r.nome}</button>,
          },
        ]}
        rows={[{ nome: 'Item 1' }]}
        rowKey={(r) => r.nome}
      />,
    );

    const botao = screen.getByRole('button', { name: 'Abrir Item 1' });
    botao.focus();
    expect(botao).toHaveFocus();
  });
});

/**
 * AT-330 (RN-643): abaixo do breakpoint móvel a tabela vira PILHA de cartões —
 * cada célula com o rótulo da própria coluna, e o cabeçalho de grade some.
 */
describe('Table — layout estreito', () => {
  let largura: ReturnType<typeof simularLayoutMovel> | null = null;
  afterEach(() => {
    largura?.restaurar();
    largura = null;
  });

  const colunas = [
    { key: 'nome', label: 'Nome', width: '2fr', render: (r: { nome: string }) => r.nome },
    { key: 'estado', label: 'Estado', render: (r: { nome: string }) => `ok-${r.nome}` },
    {
      key: 'acao',
      label: '',
      render: (r: { nome: string }) => <button type="button">Abrir {r.nome}</button>,
    },
  ];

  it('no móvel, cada linha é um cartão com o rótulo da coluna ao lado de cada valor', () => {
    largura = simularLayoutMovel(true);
    const { container } = render(
      <Table columns={colunas} rows={[{ nome: 'A' }, { nome: 'B' }]} rowKey={(r) => r.nome} />,
    );

    expect(container.firstElementChild).toHaveAttribute('data-layout', 'pilha');
    const cartoes = screen.getAllByTestId('linha-da-tabela');
    expect(cartoes).toHaveLength(2);
    const primeiro = within(cartoes[0]!);
    expect(primeiro.getByText('Nome')).toBeInTheDocument();
    expect(primeiro.getByText('Estado')).toBeInTheDocument();
    expect(primeiro.getByText('ok-A')).toBeInTheDocument();
    expect(primeiro.getByRole('button', { name: 'Abrir A' })).toBeInTheDocument();
    // Nenhuma grade de colunas em fração sobra para espremer o conteúdo.
    expect(container.querySelector('[style*="grid-template-columns"]')).toBeNull();
  });

  it('no desktop continua a grade com UM cabeçalho — o rótulo não se repete por linha', () => {
    const { container } = render(
      <Table columns={colunas} rows={[{ nome: 'A' }, { nome: 'B' }]} rowKey={(r) => r.nome} />,
    );

    expect(container.firstElementChild).not.toHaveAttribute('data-layout');
    expect(screen.queryAllByTestId('linha-da-tabela')).toHaveLength(0);
    expect(screen.getAllByText('Nome')).toHaveLength(1);
    expect(container.querySelector('[style*="grid-template-columns"]')).not.toBeNull();
  });

  it('cruzar o corte troca o desenho sem remontar a tela', () => {
    largura = simularLayoutMovel(false);
    render(<Table columns={colunas} rows={[{ nome: 'A' }]} rowKey={(r) => r.nome} />);
    expect(screen.queryAllByTestId('linha-da-tabela')).toHaveLength(0);

    act(() => largura!.mudar(true));
    expect(screen.getAllByTestId('linha-da-tabela')).toHaveLength(1);
  });
});
