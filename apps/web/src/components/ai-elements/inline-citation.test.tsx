import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { MarkdownMessage } from '../ui/MarkdownMessage';
import { citacoesDoTurno } from '../../lib/fontes-do-turno';
import { SeloDeCitacao } from './inline-citation';

const enviar = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../lib/api-client', () => ({ sendSourceClick: enviar }));

const fontes = [{ tipo: 'historia' as const, rotulo: 'Login', ref: 'st-1' }];
const selo = (n: number) =>
  n === 1 ? <SeloDeCitacao n={1} fonte={fontes[0]!} projectId="p1" sessionId="s1" eventId="e1" /> : null;

describe('selos de citação (AT-716)', () => {
  it('[1] vira selo com nome acessível; [3] inventado some', () => {
    const { container } = render(<MarkdownMessage text="Veja [1] e [3] ok" selo={selo} />);
    expect(screen.getByRole('button', { name: /1: Login/ })).toBeTruthy();
    expect(container.textContent).not.toContain('[3]');
  });
  it('[1] em código fica literal; sem selo o texto não muda', () => {
    const { container } = render(<MarkdownMessage text={'`a[1]`\n\ntexto [2]'} selo={selo} />);
    expect(container.textContent).toContain('a[1]');
    expect(container.textContent).not.toContain('[2]');
    const sem = render(<MarkdownMessage text="x [1]" />);
    expect(sem.container.textContent).toContain('x [1]');
  });
  it('o link do selo grava o clique', async () => {
    render(<SeloDeCitacao n={1} fonte={fontes[0]!} projectId="p1" sessionId="s1" eventId="e1" />);
    fireEvent.focus(screen.getByTestId('selo-de-citacao'));
    fireEvent.click(await screen.findByText('Login'));
    expect(enviar).toHaveBeenCalledWith('p1', expect.objectContaining({ eventId: 'e1', ref: 'st-1' }));
  });
  it('citacoes malformadas => []', () => {
    expect(citacoesDoTurno({ citacoes: [1, 5, 'a', 1.5] }, 2)).toEqual([1]);
    expect(citacoesDoTurno({}, 2)).toEqual([]);
  });
});
