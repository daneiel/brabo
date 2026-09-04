import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from './Table';

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
