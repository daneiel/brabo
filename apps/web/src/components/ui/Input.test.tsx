import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import uiPtBR from '../../locales/pt-BR/ui.json';
import { Input } from './Input';
import styles from './Input.module.css';

/**
 * Instância própria de i18next (mesmo padrão de `AccountPage.test.tsx`), só
 * com o namespace `ui` e `lng: 'pt-BR'` — mantém as asserções em português
 * que este teste já fazia antes da extração.
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'ui',
    ns: ['ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderComI18n(node: ReactElement) {
  return render(<I18nextProvider i18n={novaInstanciaI18n()}>{node}</I18nextProvider>);
}

/**
 * O campo, nas duas props que o ADR 0036 acrescentou.
 *
 * **`preenchido` é opt-in de propósito.** É a segunda anatomia de campo do design
 * system — a do mock de login: fundo `--surface-2`, 42px de altura, 14px de
 * texto. O `Input` é usado por cinco telas fora de auth, e o
 * `design/COMPONENTS.md` especifica `--surface-0`/`--surface-1` e o campo mais
 * baixo; trocar o default restilizaria essas cinco em silêncio — então a variante
 * é pedida, não herdada. (O default ainda deixa campo e card com o mesmo fundo
 * sobre `--surface-1`; é problema real das outras telas, e mudança própria.)
 *
 * **`revelavel` mora aqui e não na tela** porque é anatomia de campo: o botão se
 * posiciona dentro da caixa e alterna o `type`. As duas telas com senha herdam em
 * vez de reimplementar.
 *
 * O que os testes guardam além disso é a a11y que a Fase 7a já tinha e que não
 * pode regredir: `label` ligado por `htmlFor`/`id` de `useId()`, `aria-invalid` e
 * `role="alert"` no erro. `LoginPage.test.tsx` depende dos três.
 */
describe('Input', () => {
  describe('preenchido', () => {
    it('aplica a classe quando pedido', () => {
      renderComI18n(<Input label="E-mail" preenchido />);
      expect(screen.getByLabelText('E-mail')).toHaveClass(styles.preenchido);
    });

    it('não aplica por default — as telas fora de auth não mudam', () => {
      renderComI18n(<Input label="E-mail" />);
      expect(screen.getByLabelText('E-mail')).not.toHaveClass(
        styles.preenchido,
      );
    });
  });

  describe('revelavel', () => {
    it('alterna o type entre password e text', () => {
      renderComI18n(<Input label="Senha" type="password" revelavel />);
      const campo = screen.getByLabelText('Senha');
      expect(campo).toHaveAttribute('type', 'password');

      fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      expect(campo).toHaveAttribute('type', 'text');

      fireEvent.click(screen.getByRole('button', { name: 'Esconder senha' }));
      expect(campo).toHaveAttribute('type', 'password');
    });

    it('o rótulo do botão diz a AÇÃO, e aria-pressed diz o estado', () => {
      // Rótulo de estado ("senha visível") deixaria quem usa leitor de tela sem
      // saber o que o botão faz.
      renderComI18n(<Input label="Senha" type="password" revelavel />);
      const botao = screen.getByRole('button', { name: 'Mostrar senha' });
      expect(botao).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(botao);
      expect(
        screen.getByRole('button', { name: 'Esconder senha' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('é ignorado quando o campo não é senha', () => {
      // Um olho que não esconde nada seria promessa falsa.
      renderComI18n(<Input label="E-mail" type="email" revelavel />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('o botão é alcançável por teclado — é um <button>, não um ícone clicável', () => {
      renderComI18n(<Input label="Senha" type="password" revelavel />);
      const botao = screen.getByRole('button', { name: 'Mostrar senha' });
      botao.focus();
      expect(botao).toHaveFocus();
      // `type="button"` para não submeter o formulário ao alternar.
      expect(botao).toHaveAttribute('type', 'button');
    });
  });

  describe('acaoNoLabel', () => {
    it('a ação NÃO fica dentro do <label>', () => {
      // É o ponto do teste. O mock põe o "Esqueci minha senha" dentro do
      // `<label>` da senha — e clique em qualquer lugar de um `<label>` ativa o
      // campo associado, então ali o link também focaria o campo de senha.
      renderComI18n(
        <Input
          label="Senha"
          type="password"
          acaoNoLabel={<button type="button">Esqueci minha senha</button>}
        />,
      );
      const acao = screen.getByRole('button', { name: 'Esqueci minha senha' });
      expect(acao.closest('label')).toBeNull();
    });

    it('o rótulo continua ligado ao campo', () => {
      renderComI18n(
        <Input
          label="Senha"
          type="password"
          acaoNoLabel={<button type="button">Esqueci minha senha</button>}
        />,
      );
      expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    });

    it('renderiza a linha mesmo sem label, erro ou hint', () => {
      // Sem esta guarda o `Input` cairia no retorno curto e a ação
      // desapareceria sem erro nenhum.
      renderComI18n(<Input acaoNoLabel={<button type="button">Ajuda</button>} />);
      expect(screen.getByRole('button', { name: 'Ajuda' })).toBeInTheDocument();
    });
  });

  describe('a a11y da Fase 7a não regride', () => {
    it('label liga ao campo', () => {
      renderComI18n(<Input label="E-mail" />);
      expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    });

    it('erro é anunciado e marca o campo como inválido', () => {
      renderComI18n(<Input label="Senha" error="E-mail ou senha incorretos." />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'E-mail ou senha incorretos.',
      );
      expect(screen.getByLabelText('Senha')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('erro e revelavel convivem: o campo fica inválido e ainda alterna', () => {
      renderComI18n(
        <Input label="Senha" type="password" revelavel error="Incorretos." />,
      );
      expect(screen.getByLabelText('Senha')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');
    });
  });
});
