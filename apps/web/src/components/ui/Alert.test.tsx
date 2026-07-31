import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';

/**
 * O componente de alerta (ADR 0036).
 *
 * O que se protege aqui não é a aparência — é **o papel de acessibilidade não
 * ser derivado do tom**. `role="alert"` é live region assertiva: o leitor de tela
 * interrompe o que estiver falando. Isso é certo para o resultado de uma ação que
 * o usuário acabou de disparar, e errado para texto que já estava na tela quando
 * ela abriu.
 *
 * Há uma segunda razão, e ela é testável de fora: `LoginPage.test.tsx` afirma que
 * o `role="alert"` da tela de login **não** contém as palavras do aviso de
 * migração — é assim que aquele teste guarda a anti-enumeração. Se o `Alert`
 * ganhasse `role="alert"` por causa do tom, o aviso de migração (tom `warning`)
 * entraria na mesma live region e aquela asserção passaria a ler "migrada" dentro
 * do alerta de credencial.
 */
describe('Alert', () => {
  it('não tem papel nenhum por default', () => {
    // O default silencioso é o que torna seguro usar o componente em texto
    // estático de página.
    const { container } = render(<Alert>Aviso qualquer</Alert>);
    expect(container.querySelector('[role]')).toBeNull();
  });

  it('anuncia como alert quando pedido', () => {
    render(<Alert role="alert">Falhou</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou');
  });

  it('anuncia como status quando pedido', () => {
    // `status` é polido: espera o leitor terminar a frase. Certo para confirmação.
    render(<Alert role="status">Enviado</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Enviado');
  });

  it('o tom NÃO decide o papel', () => {
    // O coração do teste. Tom é cor; papel é anúncio.
    const { container } = render(<Alert tone="danger">Erro sem anúncio</Alert>);
    expect(container.querySelector('[role]')).toBeNull();
  });

  it('o ícone é decorativo — não entra no nome acessível', () => {
    // O ícone repete o que o texto já diz. Anunciá-lo seria ruído.
    render(<Alert role="alert">Só o texto conta</Alert>);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Só o texto conta');
    expect(alerta.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('preserva marcação rica no conteúdo', () => {
    // O aviso de migração depende disto: o nome da ação vem em negrito.
    render(
      <Alert>
        Peça o link em <strong>Esqueci minha senha</strong>.
      </Alert>,
    );
    expect(screen.getByText('Esqueci minha senha').tagName).toBe('STRONG');
  });

  it.each(['danger', 'warning', 'success', 'accent'] as const)(
    'aceita o tom %s sem levantar',
    (tone) => {
      expect(() => render(<Alert tone={tone}>x</Alert>)).not.toThrow();
    },
  );
});
