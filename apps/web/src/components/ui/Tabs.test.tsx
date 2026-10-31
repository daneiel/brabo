import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

const ITENS = [
  { key: 'a', label: 'Alfa', count: 3 },
  { key: 'b', label: 'Beta' },
];

describe('Tabs (AT-646)', () => {
  it('uma tablist com a aba ativa selecionada; clicar avisa a chave', () => {
    const onChange = vi.fn();
    render(<Tabs items={ITENS} active="a" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: /Alfa/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('as setas movem o foco entre as abas', async () => {
    render(<Tabs items={ITENS} active="a" onChange={vi.fn()} />);
    screen.getByRole('tab', { name: /Alfa/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
  });
});
