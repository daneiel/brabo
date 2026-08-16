import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

/**
 * A tela de login (Fase 7a — o corte).
 *
 * O que importa aqui não é o layout: é a tela NÃO reintroduzir, no cliente, a
 * enumeração que o servidor fecha. A api devolve o mesmo 401 para e-mail
 * inexistente, senha errada, conta bloqueada e conta migrada — se esta tela
 * tentasse traduzir cada caso, estaria inventando informação que não recebeu.
 */
function montar(
  onEntrar = vi.fn().mockResolvedValue({ ok: true }),
  irPara = vi.fn(),
) {
  render(<LoginPage onEntrar={onEntrar} irPara={irPara} />);
  return { onEntrar, irPara };
}

function preencher(email = 'fulano@brabo.dev', senha = 'uma senha comprida') {
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: senha },
  });
}

describe('LoginPage', () => {
  it('caminho feliz: envia as credenciais e navega para a raiz', async () => {
    const { onEntrar, irPara } = montar();

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(onEntrar).toHaveBeenCalledWith(
        'fulano@brabo.dev',
        'uma senha comprida',
      );
    });
    expect(irPara).toHaveBeenCalledWith('/');
  });

  it('401 mostra a MESMA mensagem, sem dizer o que falhou', async () => {
    const { irPara } = montar(vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('E-mail ou senha incorretos.');
    // Nada que sugira que a conta existe, que está bloqueada, ou que é legada.
    expect(alerta).not.toHaveTextContent(/bloquead|não existe|migrad|senha antiga/i);
    expect(irPara).not.toHaveBeenCalled();
  });

  it('403 é o único caso distinto — e a senha já foi provada', async () => {
    // A api só responde 403 depois de a senha conferir (e-mail não verificado),
    // então diferenciar aqui não conta nada a quem não sabia a senha.
    montar(vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Confirme seu e-mail/i,
    );
  });

  it('falha de rede não vira "credenciais inválidas"', async () => {
    // Dizer "senha errada" quando o servidor caiu manda o usuário trocar uma
    // senha que estava certa.
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /não foi possível falar com o servidor/i,
    );
  });

  it('desabilita o botão enquanto envia', async () => {
    let liberar: (v: unknown) => void = () => {};
    const onEntrar = vi.fn().mockReturnValue(
      new Promise((r) => {
        liberar = r;
      }),
    );
    montar(onEntrar);

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const botao = await screen.findByRole('button', { name: 'Autenticando…' });
    expect(botao).toBeDisabled();

    liberar({ ok: true });
  });

  it('explica a migração sem afirmar nada sobre a conta', async () => {
    // Texto FIXO, presente sempre — derivado de nenhum sinal do servidor, e é
    // por isso que ele pode existir sem vazar.
    montar();

    expect(
      screen.getByText(/a senha antiga não foi migrada/i),
    ).toBeInTheDocument();
  });

  it('leva para registro e para esqueci-senha', () => {
    const { irPara } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Criar uma conta' }));
    expect(irPara).toHaveBeenCalledWith('/registrar');

    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    expect(irPara).toHaveBeenCalledWith('/esqueci-senha');
  });

  describe('login social (ADR 0084)', () => {
    it('os dois links apontam para as rotas de início do OAuth, sem fetch nenhum', () => {
      montar();

      const github = screen.getByRole('link', { name: /Continuar com GitHub/ });
      const gitlab = screen.getByRole('link', { name: /Continuar com GitLab/ });

      expect(github).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/oauth\/github\/start$/),
      );
      expect(gitlab).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/oauth\/gitlab\/start$/),
      );
    });

    it('?oauth_error=1 mostra um alerta genérico, sem detalhar o motivo (RN-283)', () => {
      render(
        <LoginPage onEntrar={vi.fn()} irPara={vi.fn()} erroOAuth />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        /não foi possível concluir o login social/i,
      );
    });
  });
});
