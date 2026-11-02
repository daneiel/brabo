import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InputGroup } from '@/components/shadcn/input-group';
import { PromptInputFooter, PromptInputToolbar } from './prompt-input';

describe('PromptInputToolbar', () => {
  it('renderiza a barra abaixo do campo e mantém Enviar como o primeiro botão', () => {
    render(
      <InputGroup>
        <textarea aria-label="campo" />
        <PromptInputToolbar>
          <button>Enviar</button>
          <button>Parar</button>
        </PromptInputToolbar>
      </InputGroup>,
    );
    const botoes = screen.getAllByRole('button');
    expect(botoes[0]).toHaveTextContent('Enviar');
    expect(botoes[0].closest('[data-align="block-end"]')).not.toBeNull();
  });

  it('o envio segue desabilitado quando o dono da barra o desabilita', () => {
    render(
      <PromptInputToolbar>
        <button disabled>Enviar</button>
      </PromptInputToolbar>,
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });
});

describe('PromptInputFooter', () => {
  it('renderiza o conteúdo do rodapé', () => {
    render(<PromptInputFooter>aviso</PromptInputFooter>);
    expect(screen.getByText('aviso')).toBeInTheDocument();
  });
});
