import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Context } from './context';
import { Plan } from './plan';
import { Queue } from './queue';
import { Subagent } from './subagent';
import { Tool } from './tool';

describe('ai-elements: passos do agente', () => {
  it('Tool mostra entrada/saída ao abrir; ok:false mostra o erro', () => {
    const { container } = render(<Tool titulo="ls" estado="error" entrada="{a:1}" saida="x" erro="falhou" avisoDeTruncada="cortada" />);
    fireEvent.click(container.querySelector('[data-slot="trace-collapsible-trigger"]')!);
    expect(container.querySelector('[data-slot="ai-tool-input"]')?.textContent).toBe('{a:1}');
    expect(screen.getByRole('alert').textContent).toBe('falhou');
    expect(screen.getByText('cortada')).toBeTruthy();
  });

  it('Plan risca o descartado', () => {
    render(<Plan objetivo="o" passos={[{ texto: 'a', estado: 'feito' }, { texto: 'b', estado: 'descartado' }]} />);
    expect(screen.getByText('b').className).toContain('line-through');
    expect(screen.getByText('a').className).not.toContain('line-through');
  });

  it('Queue cancela só quem enviou', () => {
    const onCancelar = vi.fn();
    render(<Queue rotuloCancelar="cancelar" onCancelar={onCancelar} itens={[{ id: '1', texto: 'm1', podeCancelar: true }, { id: '2', texto: 'm2', podeCancelar: false }]} />);
    expect(screen.getAllByRole('button', { name: 'cancelar' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'cancelar' }));
    expect(onCancelar).toHaveBeenCalledWith('1');
  });

  it('Subagent mostra nome e etiqueta', () => {
    render(<Subagent nome="dev-api" etiqueta="módulo">corpo</Subagent>);
    expect(screen.getByText('dev-api')).toBeTruthy();
    expect(screen.getByText('módulo')).toBeTruthy();
  });

  it('Context com janela nula diz não sei, nunca 0%', async () => {
    render(<Context usados={10} janela={null} rotulo="r" textoSemJanela="não sei">gatilho</Context>);
    fireEvent.mouseEnter(screen.getByText('gatilho'));
    fireEvent.focus(screen.getByText('gatilho'));
    expect(await screen.findByText('não sei')).toBeTruthy();
    expect(document.body.textContent).not.toContain('0%');
  });
});
