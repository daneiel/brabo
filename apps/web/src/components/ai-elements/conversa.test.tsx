import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Confirmacao } from './confirmation';
import { MensagemDeConversa } from './message';
import { CampoDePrompt } from './prompt-input';
import { Sugestoes } from './suggestion';

describe('ai-elements/conversa (AT-647 A1)', () => {
  it('mensagem do usuário alinha ao fim e mostra autor e rodapé', () => {
    const { container } = render(
      <MensagemDeConversa align="end" autor="Você" rodape="10:00">
        oi
      </MensagemDeConversa>,
    );
    expect(container.querySelector('[data-slot="message"]')?.getAttribute('data-align')).toBe('end');
    expect(screen.getByText('Você')).toBeTruthy();
    expect(screen.getByText('10:00')).toBeTruthy();
  });

  it('autor em nó, avatar cru e props repassadas ao Message; sem filho, sem balão', () => {
    const { container } = render(
      <MensagemDeConversa
        id="event-1"
        data-testid="m"
        autor={<b>Ana</b>}
        avatar={<i data-testid="av" />}
        variant="destructive"
      >
        {''}
      </MensagemDeConversa>,
    );
    expect(container.querySelector('[data-slot="message-header"] b')?.textContent).toBe('Ana');
    expect(screen.getByTestId('m').id).toBe('event-1');
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toBeNull();
    expect(container.querySelector('[data-slot="bubble"]')).toBeNull();
  });

  it('sugestão devolve o texto; lista vazia não renderiza nada', () => {
    const onEscolher = vi.fn();
    const { container, rerender } = render(<Sugestoes sugestoes={['a', 'b']} onEscolher={onEscolher} />);
    fireEvent.click(screen.getByText('b'));
    expect(onEscolher).toHaveBeenCalledWith('b');
    rerender(<Sugestoes sugestoes={[]} onEscolher={onEscolher} />);
    expect(container.firstChild).toBeNull();
  });

  it('prompt: Enter envia aparado e limpa; Shift+Enter e vazio não enviam', () => {
    const onEnviar = vi.fn();
    render(<CampoDePrompt onEnviar={onEnviar} placeholder="msg" rotuloEnviar="Enviar" />);
    const ta = screen.getByLabelText('msg');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onEnviar).not.toHaveBeenCalled();
    fireEvent.change(ta, { target: { value: '  olá ' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onEnviar).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onEnviar).toHaveBeenCalledWith('olá');
    expect((ta as HTMLTextAreaElement).value).toBe('');
  });

  it('confirmação chama aprovar/recusar e fica inerte com decisão em voo', () => {
    const onAprovar = vi.fn();
    const onRecusar = vi.fn();
    const props = { titulo: 'Rodar x', rotuloAprovar: 'Aprovar', rotuloRecusar: 'Recusar', onAprovar, onRecusar };
    const { rerender } = render(<Confirmacao {...props} />);
    fireEvent.click(screen.getByText('Aprovar'));
    fireEvent.click(screen.getByText('Recusar'));
    expect(onAprovar).toHaveBeenCalledTimes(1);
    expect(onRecusar).toHaveBeenCalledTimes(1);
    rerender(<Confirmacao {...props} desabilitado />);
    fireEvent.click(screen.getByText('Aprovar'));
    expect(onAprovar).toHaveBeenCalledTimes(1);
  });
});
