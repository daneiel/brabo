import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VerifyEmailPage } from './VerifyEmailPage';

/**
 * Confirmação de e-mail a partir do link (backlog "SMTP real no MailSender"
 * — ver ADR 0096). Espelha `SetPasswordPage.test.tsx`: mesma resposta única
 * para link inexistente/expirado/já usado, e o mesmo desfecho de não logar
 * ninguém. A diferença é que aqui a confirmação dispara sozinha ao montar —
 * não há formulário —, então os três estados da RN-088 (carregando/erro/
 * sucesso) importam mais do que em qualquer outra tela de auth.
 */
function montar(
  onVerificar = vi.fn().mockResolvedValue({ ok: true }),
  token: string | undefined = 'tok-123',
) {
  const irPara = vi.fn();
  render(
    <VerifyEmailPage token={token} onVerificar={onVerificar} irPara={irPara} />,
  );
  return { onVerificar, irPara };
}

describe('VerifyEmailPage', () => {
  it('caminho feliz: dispara sozinho com o token e mostra sucesso', async () => {
    const { onVerificar } = montar();

    await waitFor(() => {
      expect(onVerificar).toHaveBeenCalledWith('tok-123');
    });

    const sucesso = await screen.findByRole('status');
    expect(sucesso).toHaveTextContent(/e-mail foi confirmado/i);
  });

  it('não loga ninguém: o desfecho é o botão para o login', async () => {
    const { irPara } = montar();

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Ir para o login' }));
    expect(irPara).toHaveBeenCalledWith('/login');
  });

  it('link sem token nem tenta — e não gasta requisição', async () => {
    // Renderizado à mão, sem o `montar`: `montar(x, undefined)` cairia no
    // default do parâmetro, que é justamente ter token — o caso a testar
    // desapareceria (mesma pegadinha documentada em SetPasswordPage.test.tsx).
    const onVerificar = vi.fn();
    render(
      <VerifyEmailPage
        token={undefined}
        onVerificar={onVerificar}
        irPara={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /falta o código/i,
    );
    expect(onVerificar).not.toHaveBeenCalled();
  });

  it('token recusado dá UMA mensagem para os três casos', async () => {
    // Inexistente, expirado e já usado. Distinguir contaria a quem roubou o
    // token se a vítima chegou primeiro.
    montar(vi.fn().mockResolvedValue({ ok: false }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/inválido, expirado ou já usado/i);
  });

  it('falha de rede não vira "link inválido"', async () => {
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /não foi possível falar com o servidor/i,
    );
  });

  it('mostra estado de carregando antes de resolver', () => {
    let liberar: (v: { ok: boolean }) => void = () => {};
    montar(
      vi.fn().mockReturnValue(
        new Promise((r) => {
          liberar = r;
        }),
      ),
    );

    expect(screen.getByText(/verificando/i)).toBeInTheDocument();

    liberar({ ok: true });
  });
});
