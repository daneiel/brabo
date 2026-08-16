import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeBottomPanel } from './CodeBottomPanel';

vi.mock('./CodeDiffPanel', () => ({
  CodeDiffPanel: () => <div>painel de diff</div>,
}));

describe('CodeBottomPanel', () => {
  it('abre em Terminal, com o estado vazio honesto da FASE 25b', () => {
    render(<CodeBottomPanel projectId="p-1" />);
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/terminal interativo do container/)).toBeInTheDocument();
  });

  it('as quatro abas do handoff existem: Terminal, Problemas, Diff de PR e Saída', () => {
    render(<CodeBottomPanel projectId="p-1" />);
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Problemas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff de PR' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saída' })).toBeInTheDocument();
  });

  it('Problemas diz honestamente que não há lint/teste integrado, sem contagem inventada', async () => {
    const user = userEvent.setup();
    render(<CodeBottomPanel projectId="p-1" />);
    await user.click(screen.getByRole('tab', { name: 'Problemas' }));
    expect(screen.getByText(/Não há lint nem testes integrados/)).toBeInTheDocument();
  });

  it('Saída diz honestamente que não há stream de comando, sem simular execução', async () => {
    const user = userEvent.setup();
    render(<CodeBottomPanel projectId="p-1" />);
    await user.click(screen.getByRole('tab', { name: 'Saída' }));
    expect(screen.getByText(/Não há stream de comando de build ou deploy/)).toBeInTheDocument();
  });

  it('Diff continua sendo a única aba com dado real', async () => {
    const user = userEvent.setup();
    render(<CodeBottomPanel projectId="p-1" />);
    await user.click(screen.getByRole('tab', { name: 'Diff de PR' }));
    expect(await screen.findByText('painel de diff')).toBeInTheDocument();
  });
});
