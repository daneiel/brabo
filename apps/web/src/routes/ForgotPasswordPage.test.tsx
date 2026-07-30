import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForgotPasswordPage } from './ForgotPasswordPage';

/**
 * Pedido de redefinição (Fase 7a; não tinha spec até o ADR 0036).
 *
 * Esta tela tem uma propriedade que nenhuma outra tem, e ela parece um bug: **o
 * sucesso é mostrado mesmo quando a api recusa.** É deliberado. A resposta é 202
 * para endereço conhecido e desconhecido; se a tela distinguisse os dois casos,
 * ela viraria o oráculo de enumeração que o servidor fecha — bastaria digitar
 * e-mails e olhar a tela.
 *
 * A única coisa que muda o desfecho é a requisição não chegar. Erro de rede tem
 * mensagem própria, porque "enviamos o link" quando nada saiu deixa a pessoa
 * esperando um e-mail que não existe.
 *
 * É também o caminho do usuário MIGRADO: a senha do Keycloak não veio junto, e o
 * `set_initial_password` é emitido por aqui. Daí o aviso fora do card falar em
 * definir a primeira senha, e não só em redefinir.
 */
function montar(onPedir = vi.fn().mockResolvedValue({ ok: true })) {
  const irPara = vi.fn();
  render(<ForgotPasswordPage onPedir={onPedir} irPara={irPara} />);
  return { onPedir, irPara };
}

function pedir(email = 'migrado@brabo.dev') {
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
}

describe('ForgotPasswordPage', () => {
  it('caminho feliz: pede o link e mostra o aviso condicional', async () => {
    const { onPedir } = montar();

    pedir();

    await waitFor(() => {
      expect(onPedir).toHaveBeenCalledWith('migrado@brabo.dev');
    });

    const sucesso = await screen.findByRole('status');
    expect(sucesso).toHaveTextContent(/se houver uma conta/i);
    expect(sucesso).toHaveTextContent('migrado@brabo.dev');
  });

  it('api recusando dá o MESMO desfecho — é a anti-enumeração', async () => {
    // O ponto central do arquivo. `ok: false` e `ok: true` são
    // indistinguíveis daqui, porque distinguir contaria se a conta existe.
    montar(vi.fn().mockResolvedValue({ ok: false }));

    pedir();

    expect(await screen.findByRole('status')).toHaveTextContent(
      /se houver uma conta/i,
    );
  });

  it('erro de rede NÃO é mostrado como sucesso', async () => {
    // A distinção que vale: a requisição não chegou. Dizer "enviamos" aqui
    // deixaria a pessoa esperando um e-mail que nunca foi gerado.
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    pedir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /não foi possível falar com o servidor/i,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explica o caso do migrado sem afirmar nada sobre a conta', () => {
    // Texto FIXO, presente sempre — não deriva de resposta nenhuma do servidor,
    // e é por isso que pode existir sem vazar.
    montar();

    expect(
      screen.getByText(/a senha antiga não foi migrada/i),
    ).toBeInTheDocument();
  });

  it('o aviso de migração não entra na live region do erro', async () => {
    // Se entrasse, o anúncio de uma falha de rede passaria a incluir "senha
    // antiga não foi migrada" — insinuação sobre a conta dentro de um alerta.
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    pedir();

    expect(await screen.findByRole('alert')).not.toHaveTextContent(
      /migrad|senha antiga/i,
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

    pedir();

    const botao = await screen.findByRole('button', { name: 'Enviando…' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');

    liberar({ ok: true });
  });

  it('volta para o login, do formulário e da confirmação', async () => {
    const { irPara } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o login' }));
    expect(irPara).toHaveBeenCalledWith('/login');

    pedir();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o login' }));
    expect(irPara).toHaveBeenCalledTimes(2);
  });
});
