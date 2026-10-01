import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

const OPCOES = [
  { valor: 'open', rotulo: 'Abertas' },
  { valor: 'merged', rotulo: 'Mescladas' },
] as const;

describe('SegmentedControl (AT-327)', () => {
  it('um grupo rotulado de botões de alternar, com UM ligado', () => {
    render(<SegmentedControl opcoes={OPCOES} valor="open" onChange={vi.fn()} rotulo="Filtrar por estado" />);
    const grupo = screen.getByRole('group', { name: 'Filtrar por estado' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abertas' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mescladas' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('clicar numa opção avisa o valor dela', () => {
    const onChange = vi.fn();
    render(<SegmentedControl opcoes={OPCOES} valor="open" onChange={onChange} rotulo="Filtro" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mescladas' }));
    expect(onChange).toHaveBeenCalledWith('merged');
  });

  it('caso de falha evitado: não se anuncia como abas sem painel', () => {
    render(<SegmentedControl opcoes={OPCOES} valor="merged" onChange={vi.fn()} rotulo="Filtro" />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
