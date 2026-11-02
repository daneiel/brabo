import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactCard } from './artifact';
import { Confirmacao } from './confirmation';
import { AcaoCopiar } from './copiar';
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

  it('copiar: grava o texto no clipboard e troca o rótulo para copiado', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<AcaoCopiar texto="# oi" rotulo="Copiar resposta" rotuloCopiado="Copiado" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar resposta' }));
    expect(writeText).toHaveBeenCalledWith('# oi');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();
  });

  it('copiar: sem clipboard ou com recusa, não quebra nem marca copiado', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { rerender } = render(<AcaoCopiar texto="x" rotulo="Copiar" rotuloCopiado="Copiado" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    const writeText = vi.fn().mockRejectedValue(new Error('negado'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    rerender(<AcaoCopiar texto="y" rotulo="Copiar" rotuloCopiado="Copiado" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy();
  });

  it('artifact: mostra tipo, título, trecho e ação; sem opcionais, só o essencial', () => {
    const { container, rerender } = render(
      <ArtifactCard tipo="Épico criado" titulo="Login" descricao="d" acao={<a href="/x">Abrir</a>} />,
    );
    expect(container.querySelector('[data-slot="ai-artifact-tipo"]')?.textContent).toBe('Épico criado');
    expect(screen.getByText('Login')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir' })).toBeTruthy();
    rerender(<ArtifactCard tipo="t" titulo="u" />);
    expect(container.querySelector('[data-slot="ai-artifact-descricao"]')).toBeNull();
    expect(container.querySelector('[data-slot="ai-artifact-acao"]')).toBeNull();
  });
});
