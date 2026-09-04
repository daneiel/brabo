import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import type { ReactElement } from 'react';
import authEn from '../locales/en/auth.json';
import authPtBR from '../locales/pt-BR/auth.json';
import uiEn from '../locales/en/ui.json';
import uiPtBR from '../locales/pt-BR/ui.json';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { SetPasswordPage } from './SetPasswordPage';

/**
 * axe nas quatro telas de auth, nos estados vazio, de erro e de sucesso.
 *
 * ## O que este arquivo NÃO prova
 *
 * **Contraste.** A regra `color-contrast` do axe precisa de layout e de cor
 * resolvida, e jsdom não tem nem um nem outro: não aplica CSS Module, não resolve
 * `var()` e devolve tudo com cor vazia. Rodar a regra aqui produziria "passou"
 * sem ter olhado nada — o pior resultado possível, porque parece cobertura. Ela
 * está desligada explicitamente, e o contraste é verificado por cálculo direto
 * sobre os tokens em `design-contraste.test.ts`.
 *
 * O que sobra é justamente o que jsdom sabe: estrutura. Rótulo ligado ao campo,
 * botão com nome acessível, `role` válido para o elemento, ordem de cabeçalhos,
 * ARIA sem atributo inventado, nada de conteúdo fora de landmark. É onde as
 * regressões de acessibilidade destas telas realmente moram — foram escritas à
 * mão, com `<button>` fazendo papel de link e `<span>` fazendo papel de rótulo.
 *
 * `usarSó`/`desligar` mantêm a lista visível: quem desligar mais uma regra vai
 * ter que escrever aqui por quê.
 */
const REGRAS_DESLIGADAS = {
  // Precisa de renderização real. Ver `design-contraste.test.ts`.
  'color-contrast': { enabled: false },
} satisfies axe.RuleObject;

async function semViolacoes(no: HTMLElement) {
  const r = await axe.run(no, {
    rules: REGRAS_DESLIGADAS,
    resultTypes: ['violations'],
  });

  // A mensagem precisa dizer O QUE quebrou: `expect([]).toEqual([])` num teste de
  // a11y que falha manda a pessoa abrir o axe na mão para descobrir a regra.
  const resumo = r.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} nó(s)`,
  );
  expect(resumo).toEqual([]);
}

const naoImporta = () => {};

// Instância REAL de i18next, com os recursos do namespace "auth" — mesmo
// padrão de LoginPage.test.tsx/AuthLayout.test.tsx: as quatro telas usam
// `useTranslation('auth')`, e nenhuma vem com provider próprio.
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

describe('a11y das telas de auth', () => {
  describe('login', () => {
    it('estado vazio', async () => {
      const { container } = renderar(
        <LoginPage
          onEntrar={vi.fn().mockResolvedValue({ ok: true })}
          irPara={naoImporta}
        />,
      );
      await semViolacoes(container);
    });

    it('com erro de credencial e senha revelada', async () => {
      // Os dois estados juntos de propósito: é a combinação em que existem, ao
      // mesmo tempo, uma live region, um `aria-pressed` e um campo cujo `type`
      // mudou depois da montagem.
      const { container } = renderar(
        <LoginPage
          onEntrar={vi.fn().mockResolvedValue({ ok: false, status: 401 })}
          irPara={naoImporta}
        />,
      );
      // Os campos precisam estar preenchidos: `required` + jsdom aplicam a
      // validação nativa, e o submit nem chegaria ao handler.
      fireEvent.change(screen.getByLabelText('E-mail'), {
        target: { value: 'a@b.dev' },
      });
      fireEvent.change(screen.getByLabelText('Senha'), {
        target: { value: 'uma senha comprida' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      await screen.findByRole('alert');
      await semViolacoes(container);
    });
  });

  describe('registro', () => {
    it('estado vazio', async () => {
      const { container } = renderar(
        <RegisterPage
          onRegistrar={vi.fn().mockResolvedValue({ ok: true, status: 202 })}
          irPara={naoImporta}
        />,
      );
      await semViolacoes(container);
    });

    it('com erro de campo na senha', async () => {
      const { container } = renderar(
        <RegisterPage
          onRegistrar={vi.fn().mockResolvedValue({ ok: true, status: 202 })}
          irPara={naoImporta}
        />,
      );
      fireEvent.change(screen.getByLabelText('E-mail'), {
        target: { value: 'a@b.dev' },
      });
      fireEvent.change(screen.getByLabelText('Senha'), {
        target: { value: 'curta' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
      await screen.findByRole('alert');
      await semViolacoes(container);
    });

    it('estado de sucesso', async () => {
      const { container } = renderar(
        <RegisterPage
          onRegistrar={vi.fn().mockResolvedValue({ ok: true, status: 202 })}
          irPara={naoImporta}
        />,
      );
      fireEvent.change(screen.getByLabelText('E-mail'), {
        target: { value: 'a@b.dev' },
      });
      fireEvent.change(screen.getByLabelText('Senha'), {
        target: { value: 'uma senha bem comprida' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
      await screen.findByRole('status');
      await semViolacoes(container);
    });
  });

  describe('esqueci-senha', () => {
    it('estado vazio', async () => {
      const { container } = renderar(
        <ForgotPasswordPage
          onPedir={vi.fn().mockResolvedValue({ ok: true })}
          irPara={naoImporta}
        />,
      );
      await semViolacoes(container);
    });

    it('estado de sucesso', async () => {
      const { container } = renderar(
        <ForgotPasswordPage
          onPedir={vi.fn().mockResolvedValue({ ok: true })}
          irPara={naoImporta}
        />,
      );
      fireEvent.change(screen.getByLabelText('E-mail'), {
        target: { value: 'a@b.dev' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
      await screen.findByRole('status');
      await semViolacoes(container);
    });
  });

  describe('definir-senha', () => {
    it('estado vazio', async () => {
      const { container } = renderar(
        <SetPasswordPage
          token="t"
          onDefinir={vi.fn().mockResolvedValue({ ok: true, status: 200 })}
          irPara={naoImporta}
        />,
      );
      await semViolacoes(container);
    });

    it('com os dois campos de senha revelados', async () => {
      // Duas instâncias do mesmo toggle na mesma tela: é o caso em que rótulo
      // acessível duplicado apareceria, se `aria-label` fosse de estado.
      const { container } = renderar(
        <SetPasswordPage
          token="t"
          onDefinir={vi.fn().mockResolvedValue({ ok: true, status: 200 })}
          irPara={naoImporta}
        />,
      );
      for (const b of screen.getAllByRole('button', { name: 'Mostrar senha' })) {
        fireEvent.click(b);
      }
      await semViolacoes(container);
    });

    it('estado de sucesso', async () => {
      const { container } = renderar(
        <SetPasswordPage
          token="t"
          onDefinir={vi.fn().mockResolvedValue({ ok: true, status: 200 })}
          irPara={naoImporta}
        />,
      );
      const senhas = screen.getAllByLabelText(/senha/i);
      fireEvent.change(senhas[0], { target: { value: 'uma senha comprida' } });
      fireEvent.change(senhas[1], { target: { value: 'uma senha comprida' } });
      fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
      await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
      await semViolacoes(container);
    });
  });
});
