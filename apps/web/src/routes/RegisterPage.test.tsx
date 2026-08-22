import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import authEn from '../locales/en/auth.json';
import authPtBR from '../locales/pt-BR/auth.json';
import { RegisterPage } from './RegisterPage';

/**
 * A tela de registro (Fase 7a; não tinha spec até o ADR 0036).
 *
 * O que se guarda aqui é a mesma propriedade do login vista do outro lado: a api
 * responde **202 para endereço novo e para já cadastrado**, e manda um aviso ao
 * dono no segundo caso. Um `409 Conflict` — que é o que o bom senso REST pediria —
 * entregaria a lista de usuários a quem tiver uma wordlist.
 *
 * Daí a asserção que mais importa: o texto de sucesso diz "se o endereço estiver
 * disponível", condicional, e nunca "conta criada". Quem escrever a versão
 * afirmativa reabre a enumeração sem tocar em nenhuma linha de servidor.
 *
 * A segunda propriedade é onde cada erro mora: senha curta é do CAMPO (some sob o
 * campo, com `aria-invalid`), recusa do servidor é do FORMULÁRIO (vai para o
 * alerta do topo). Misturar os dois obriga a ler a mensagem para saber onde mexer.
 */
// Instância REAL de i18next, com os recursos do namespace "auth" — mesmo
// padrão de AccountPage.test.tsx: o que se prova aqui é o texto que a tela
// mostra, não a mecânica de i18next em si.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      en: { auth: authEn },
      'pt-BR': { auth: authPtBR },
    },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'auth',
    ns: ['auth'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar(
  onRegistrar = vi.fn().mockResolvedValue({ ok: true, status: 202 }),
) {
  const irPara = vi.fn();
  render(
    <I18nextProvider i18n={novaInstanciaI18n()}>
      <RegisterPage onRegistrar={onRegistrar} irPara={irPara} />
    </I18nextProvider>,
  );
  return { onRegistrar, irPara };
}

function preencher(senha = 'uma senha bem comprida') {
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: 'novo@brabo.dev' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
}

describe('RegisterPage', () => {
  it('caminho feliz: envia e mostra a confirmação condicional', async () => {
    const { onRegistrar } = montar();

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => {
      expect(onRegistrar).toHaveBeenCalledWith(
        'novo@brabo.dev',
        'uma senha bem comprida',
        undefined,
      );
    });

    const sucesso = await screen.findByRole('status');
    expect(sucesso).toHaveTextContent(/se o endereço estiver disponível/i);
    // Nada que confirme que a conta é nova — nem que ela já existia.
    expect(sucesso).not.toHaveTextContent(/conta criada|já existe|já cadastrad/i);
  });

  it('o nome é opcional e só vai quando preenchido', async () => {
    // `''` viraria um nome vazio no banco; `undefined` deixa a coluna nula.
    const { onRegistrar } = montar();

    preencher();
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Fulano' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => {
      expect(onRegistrar).toHaveBeenCalledWith(
        'novo@brabo.dev',
        'uma senha bem comprida',
        'Fulano',
      );
    });
  });

  it('senha curta é erro DE CAMPO e nem chega ao servidor', async () => {
    const { onRegistrar } = montar();

    preencher('curta');
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/pelo menos 12 caracteres/i);
    // O campo carrega o estado inválido, porque é nele que se conserta.
    expect(screen.getByLabelText('Senha')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onRegistrar).not.toHaveBeenCalled();
  });

  it('403 diz que o cadastro está fechado — é config, não credencial', async () => {
    // `AUTH_REGISTRATION_ENABLED=false`. Dizer "confira os dados" mandaria a
    // pessoa tentar de novo para sempre.
    montar(vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /cadastro está fechado/i,
    );
  });

  it('falha de rede não vira "confira os dados"', async () => {
    montar(vi.fn().mockRejectedValue(new Error('offline')));

    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    const botao = await screen.findByRole('button', { name: 'Criando…' });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');

    liberar({ ok: true, status: 202 });
  });

  it('leva para o login pelo rodapé do card', () => {
    const { irPara } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(irPara).toHaveBeenCalledWith('/login');
  });
});
