import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetPasswordPage } from './SetPasswordPage';

/**
 * Definir senha a partir do link (Fase 7a; não tinha spec até o ADR 0036).
 *
 * Três propriedades, e todas as três são de segurança:
 *
 * 1. **O cliente não escolhe o propósito do token.** A api atende
 *    `password_reset` e `set_initial_password` (o do migrado) pela mesma rota, e
 *    tenta os dois. Se a tela pudesse dizer qual é, ela também poderia DESCOBRIR
 *    de que tipo é a conta — o mesmo vazamento por outro caminho. Daí só o token
 *    ir no payload.
 * 2. **Link inexistente, expirado e já usado têm a mesma mensagem.** Distinguir
 *    contaria a um ladrão de token se a vítima chegou primeiro.
 * 3. **Não loga ninguém no fim.** A api não emite sessão aqui: entrar direto a
 *    partir de um link de e-mail faria comprometer o e-mail equivaler a tomar a
 *    conta, sem segundo passo. O desfecho é ir para o login.
 *
 * E uma de usabilidade que também é de dados: as validações locais (comprimento,
 * confirmação) rodam ANTES da requisição, cada uma no seu campo. Um token de uso
 * único gasto por causa de senha digitada errada obrigaria a pedir outro e-mail.
 */
function montar(
  onDefinir = vi.fn().mockResolvedValue({ ok: true, status: 200 }),
) {
  const irPara = vi.fn();
  render(
    <SetPasswordPage token="tok-123" onDefinir={onDefinir} irPara={irPara} />,
  );
  return { onDefinir, irPara };
}

const SENHA = 'uma senha bem comprida';

function preencher(senha = SENHA, confirmacao = SENHA) {
  fireEvent.change(screen.getByLabelText('Senha nova'), {
    target: { value: senha },
  });
  fireEvent.change(screen.getByLabelText('Repita a senha'), {
    target: { value: confirmacao },
  });
}

function submeter() {
  fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
}

describe('SetPasswordPage', () => {
  it('caminho feliz: manda só o token e a senha, e avisa do logout global', async () => {
    const { onDefinir } = montar();

    preencher();
    submeter();

    await waitFor(() => {
      // Nada de "purpose" ou "tipo": o servidor decide qual fluxo é.
      expect(onDefinir).toHaveBeenCalledWith('tok-123', SENHA);
    });

    const sucesso = await screen.findByRole('status');
    expect(sucesso).toHaveTextContent(/sessões anteriores foram encerradas/i);
  });

  it('não loga ninguém: o desfecho é o botão para o login', async () => {
    const { irPara } = montar();

    preencher();
    submeter();
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Ir para o login' }));
    expect(irPara).toHaveBeenCalledWith('/login');
  });

  it('link sem token nem tenta — e não gasta requisição', async () => {
    // Renderizado à mão, sem o `montar`: `montar(x, undefined)` cairia no default
    // do parâmetro, que é justamente ter token — o caso a testar desapareceria.
    const onDefinir = vi.fn();
    render(
      <SetPasswordPage
        token={undefined}
        onDefinir={onDefinir}
        irPara={vi.fn()}
      />,
    );

    preencher();
    submeter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /falta o código/i,
    );
    expect(onDefinir).not.toHaveBeenCalled();
  });

  it('senha curta é erro do PRIMEIRO campo, e não gasta o token', async () => {
    const { onDefinir } = montar();

    preencher('curta', 'curta');
    submeter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /pelo menos 12 caracteres/i,
    );
    expect(screen.getByLabelText('Senha nova')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onDefinir).not.toHaveBeenCalled();
  });

  it('confirmação diferente é erro do SEGUNDO campo, e não gasta o token', async () => {
    // O campo que carrega o erro é o que a pessoa precisa reescrever.
    const { onDefinir } = montar();

    preencher(SENHA, 'outra senha comprida');
    submeter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /não são iguais/i,
    );
    expect(screen.getByLabelText('Repita a senha')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Senha nova')).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(onDefinir).not.toHaveBeenCalled();
  });

  it('token recusado dá UMA mensagem para os três casos', async () => {
    // Inexistente, expirado e já usado. Distinguir contaria a quem roubou o
    // token se a vítima chegou primeiro.
    montar(vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    preencher();
    submeter();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/inválido, expirado ou já usado/i);
    expect(alerta).not.toHaveTextContent(/já foi usado por|expirou em/i);
  });

  it('falha de rede não vira "link inválido"', async () => {
    // Mandaria a pessoa pedir outro e-mail por causa de um servidor fora do ar.
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    preencher();
    submeter();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /não foi possível falar com o servidor/i,
    );
  });

  it('o botão anuncia trabalho em curso enquanto envia', async () => {
    let liberar: (v: unknown) => void = () => {};
    montar(
      vi.fn().mockReturnValue(
        new Promise((r) => {
          liberar = r;
        }),
      ),
    );

    preencher();
    submeter();

    const botao = await screen.findByRole('button', { name: 'Definindo…' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');

    liberar({ ok: true, status: 200 });
  });

  it('leva a pedir outro link pelo rodapé do card', () => {
    const { irPara } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Pedir outro' }));
    expect(irPara).toHaveBeenCalledWith('/esqueci-senha');
  });
});
