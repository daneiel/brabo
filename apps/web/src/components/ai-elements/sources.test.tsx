import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { fontesDoTurno } from '../../lib/fontes-do-turno';
import { ConsultadoNesteTurno } from './sources';

const enviar = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ sendSourceClick: enviar }));

const vista = (payload: unknown) => {
  const { fontes, total } = fontesDoTurno(payload);
  return render(<ConsultadoNesteTurno fontes={fontes} total={total} projectId="p1" />);
};

describe('Consultado neste turno (AT-716)', () => {
  it('mostra N e os rótulos; história aponta para ?historia=; teclado abre e fecha', () => {
    const { container } = vista({
      fontes: [
        { tipo: 'historia', rotulo: 'Login', ref: 'st-1' },
        { tipo: 'adr', rotulo: 'ADR 0001' },
      ],
    });
    const gatilho = screen.getByRole('button');
    expect(gatilho.textContent).toContain('2');
    expect(container.textContent).not.toContain('Login');
    fireEvent.click(gatilho);
    expect(screen.getByText('ADR 0001').closest('a')).toBeNull();
    expect(screen.getByText('Login').closest('a')?.getAttribute('href')).toBe(
      '/projects/p1?tab=backlog&historia=st-1',
    );
    fireEvent.click(gatilho);
    expect(container.textContent).not.toContain('Login');
  });
  it('mostra o corte', () => {
    vista({ fontes: [{ tipo: 'rag', rotulo: 'a' }], fontesTotal: 25 });
    expect(screen.getByRole('button').textContent).toContain('25');
  });
  it('sem campo ou malformado, nada aparece', () => {
    for (const p of [{}, null, { fontes: 'x' }, { fontes: [null, 3, { tipo: 'x', rotulo: 'a' }] }]) {
      const { container } = vista(p);
      expect(container.innerHTML).toBe('');
    }
  });
  it('RN-983: clique em link dispara o POST sem bloquear; texto não grava', () => {
    enviar.mockReset().mockRejectedValue(new Error('x'));
    const { fontes, total } = fontesDoTurno({
      fontes: [
        { tipo: 'historia', rotulo: 'Login', ref: 'st-1' },
        { tipo: 'adr', rotulo: 'ADR 0001' },
      ],
    });
    render(<ConsultadoNesteTurno fontes={fontes} total={total} projectId="p1" sessionId="s1" eventId="e1" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('ADR 0001'));
    expect(enviar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Login'));
    expect(enviar).toHaveBeenCalledWith('p1', expect.objectContaining({ eventId: 'e1', sessionId: 's1', tipo: 'historia', ref: 'st-1' }));
  });
});
