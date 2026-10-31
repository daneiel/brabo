import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEncerrarComConfirmacao } from './ConfirmarEncerramento';
import i18n from '../lib/i18n';

await i18n.changeLanguage('pt-BR');

function Harness(props: {
  encerrar: () => Promise<void>;
  events: { type: string }[];
  ativados: string[];
}) {
  const { pedirEncerramento, modalDeEncerrar } = useEncerrarComConfirmacao(
    props.encerrar,
    props.events,
    props.ativados,
  );
  return (
    <>
      <button onClick={() => void pedirEncerramento()}>Encerrar</button>
      {modalDeEncerrar}
    </>
  );
}

describe('Encerrar sessão com execução ativa pergunta antes (AT-452, RN-769)', () => {
  it('sem execução, encerra direto, sem perguntar', async () => {
    const encerrar = vi.fn().mockResolvedValue(undefined);
    render(<Harness encerrar={encerrar} events={[{ type: 'chat.message' }]} ativados={['criativo']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(encerrar).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('confirmar-encerramento')).toBeNull();
  });

  it('com execução, abre a confirmação dizendo quem para, e só encerra ao confirmar', async () => {
    const encerrar = vi.fn().mockResolvedValue(undefined);
    render(<Harness encerrar={encerrar} events={[]} ativados={['dev-lead', 'dev-api']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    const modal = await screen.findByTestId('confirmar-encerramento');
    expect(encerrar).not.toHaveBeenCalled();
    expect(modal.textContent).toContain('dev-api');
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sessão' }));
    await waitFor(() => expect(encerrar).toHaveBeenCalledTimes(1));
  });

  it('CASO DE FALHA: cancelar não encerra', async () => {
    const encerrar = vi.fn().mockResolvedValue(undefined);
    render(<Harness encerrar={encerrar} events={[{ type: 'execution.activated' }]} ativados={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    await screen.findByTestId('confirmar-encerramento');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar rodando' }));
    expect(screen.queryByTestId('confirmar-encerramento')).toBeNull();
    expect(encerrar).not.toHaveBeenCalled();
  });
});
