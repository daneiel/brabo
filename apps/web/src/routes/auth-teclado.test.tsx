import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import type { ReactElement } from 'react';
import authEn from '../locales/en/auth.json';
import authPtBR from '../locales/pt-BR/auth.json';
import uiEn from '../locales/en/ui.json';
import uiPtBR from '../locales/pt-BR/ui.json';
import { LoginPage } from './LoginPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { SetPasswordPage } from './SetPasswordPage';

/**
 * O fluxo do usuário migrado, só por teclado.
 *
 * Este é o percurso que o corte do Keycloak criou e que ninguém pode fazer sem
 * mouse se a ordem de foco estiver errada: ler o aviso no login → chegar em
 * "Esqueci minha senha" → pedir o link → definir a senha → voltar e entrar.
 *
 * ## Por que ordem de foco merece teste
 *
 * Ela não vem do CSS, vem da ordem no DOM — e as duas divergem com facilidade
 * quando um elemento é posicionado. Dois casos concretos nestas telas:
 *
 * - o botão de revelar senha é o ÚLTIMO filho do wrapper, mas aparece DENTRO da
 *   caixa do campo. No DOM ele vem depois do input, e é essa a ordem que o Tab
 *   segue — o que é o certo: primeiro se digita, depois se confere;
 * - o "Esqueci minha senha" fica visualmente na linha do rótulo, ACIMA do campo.
 *   No DOM ele também vem antes, então o Tab passa por ele antes da senha. Se
 *   alguém "consertar" isso movendo o link para depois do campo, o visual não
 *   muda e a ordem quebra — é o que este teste pega.
 *
 * Nada de `tabIndex` positivo em lugar nenhum: ele reordena a página inteira, não
 * só o vizinho. A ordem correta se obtém escrevendo o DOM na ordem certa.
 */
// Instância REAL de i18next — mesmo padrão de LoginPage.test.tsx. `ui` entra
// porque `Input.tsx` (o botão de revelar senha) usa esse namespace.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      en: { auth: authEn, ui: uiEn },
      'pt-BR': { auth: authPtBR, ui: uiPtBR },
    },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'auth',
    ns: ['auth', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderar(no: ReactElement) {
  return render(<I18nextProvider i18n={novaInstanciaI18n()}>{no}</I18nextProvider>);
}

function focado() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return (
    el.getAttribute('aria-label') ??
    el.getAttribute('placeholder') ??
    el.textContent
  );
}

describe('navegação por teclado nas telas de auth', () => {
  it('no login, o Tab percorre o formulário na ordem em que se preenche', async () => {
    const u = userEvent.setup();
    renderar(<LoginPage onEntrar={vi.fn()} irPara={vi.fn()} />);

    await u.tab();
    expect(screen.getByLabelText('E-mail')).toHaveFocus();

    // O link do rótulo da senha vem antes do campo — é a ordem do DOM, e é a
    // mesma ordem em que o olho lê.
    await u.tab();
    expect(focado()).toBe('Esqueci minha senha');

    await u.tab();
    expect(screen.getByLabelText('Senha')).toHaveFocus();

    await u.tab();
    expect(focado()).toBe('Mostrar senha');

    await u.tab();
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveFocus();

    // Login social (ADR 0084): os dois links vêm DEPOIS do submit, ANTES do
    // rodapé do card — mesma posição visual, mesma ordem no DOM. O divisor
    // "ou" não é focável, então não conta como parada.
    await u.tab();
    expect(focado()).toBe('Continuar com GitHub');

    await u.tab();
    expect(focado()).toBe('Continuar com GitLab');

    // Depois do submit vem o rodapé do card, e só então o rodapé da página.
    await u.tab();
    expect(focado()).toBe('Criar uma conta');

    await u.tab();
    expect(focado()).toBe('Status');

    await u.tab();
    expect(focado()).toBe('Documentação');
  });

  it('Shift-Tab volta pela mesma ordem, invertida', async () => {
    // Ordem reversa quebrada é sintoma de `tabIndex` positivo em algum lugar.
    const u = userEvent.setup();
    renderar(<LoginPage onEntrar={vi.fn()} irPara={vi.fn()} />);

    screen.getByRole('link', { name: /Continuar com GitLab/ }).focus();

    await u.tab({ shift: true });
    expect(focado()).toBe('Continuar com GitHub');

    await u.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveFocus();

    await u.tab({ shift: true });
    expect(focado()).toBe('Mostrar senha');

    await u.tab({ shift: true });
    expect(screen.getByLabelText('Senha')).toHaveFocus();

    await u.tab({ shift: true });
    expect(focado()).toBe('Esqueci minha senha');

    await u.tab({ shift: true });
    expect(screen.getByLabelText('E-mail')).toHaveFocus();
  });

  it('Enter num campo de texto submete o formulário', async () => {
    // Sem isto, quem preenche e aperta Enter não entra — e não recebe erro
    // nenhum, o que é o pior modo de falha possível numa tela de login.
    const u = userEvent.setup();
    const onEntrar = vi.fn().mockResolvedValue({ ok: true });
    renderar(<LoginPage onEntrar={onEntrar} irPara={vi.fn()} />);

    await u.click(screen.getByLabelText('E-mail'));
    await u.keyboard('fulano@brabo.dev');
    await u.click(screen.getByLabelText('Senha'));
    await u.keyboard('uma senha comprida{Enter}');

    expect(onEntrar).toHaveBeenCalledWith(
      'fulano@brabo.dev',
      'uma senha comprida',
    );
  });

  it('o botão de revelar não submete o formulário', async () => {
    // `type="button"`. Sem ele, revelar a senha com Espaço dispararia o login
    // com o formulário pela metade.
    const u = userEvent.setup();
    const onEntrar = vi.fn();
    renderar(<LoginPage onEntrar={onEntrar} irPara={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    toggle.focus();
    await u.keyboard(' ');

    expect(onEntrar).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');
  });

  it('o fluxo do migrado inteiro é alcançável por teclado', async () => {
    // Três telas em sequência, cada uma navegada só com Tab e Enter. Não é
    // integração de router: é a prova de que cada passo tem um alvo focável e
    // uma ação de teclado que o dispara.
    const u = userEvent.setup();
    const irPara = vi.fn();

    // 1. No login, chegar em "Esqueci minha senha" e acioná-lo.
    const login = renderar(<LoginPage onEntrar={vi.fn()} irPara={irPara} />);
    await u.tab();
    await u.tab();
    await u.keyboard('{Enter}');
    expect(irPara).toHaveBeenCalledWith('/esqueci-senha');
    login.unmount();

    // 2. Pedir o link, com Enter no campo de e-mail.
    const onPedir = vi.fn().mockResolvedValue({ ok: true });
    const esqueci = renderar(
      <ForgotPasswordPage onPedir={onPedir} irPara={irPara} />,
    );
    await u.tab();
    await u.keyboard('migrado@brabo.dev{Enter}');
    expect(onPedir).toHaveBeenCalledWith('migrado@brabo.dev');
    // O sucesso não rouba o foco, mas é anunciado — `role="status"`.
    expect(await screen.findByRole('status')).toBeInTheDocument();
    esqueci.unmount();

    // 3. Definir a senha nova nos dois campos, submetendo com Enter.
    const onDefinir = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    renderar(
      <SetPasswordPage token="tok" onDefinir={onDefinir} irPara={irPara} />,
    );
    await u.tab();
    await u.keyboard('uma senha bem comprida');
    // Tab passa pelo botão de revelar antes de chegar ao segundo campo.
    await u.tab();
    await u.tab();
    await u.keyboard('uma senha bem comprida{Enter}');

    expect(onDefinir).toHaveBeenCalledWith('tok', 'uma senha bem comprida');
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
