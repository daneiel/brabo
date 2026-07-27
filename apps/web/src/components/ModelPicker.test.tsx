import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelPicker } from './ModelPicker';
import type { Model, ModelsByCategory } from '../lib/api-types';

/**
 * O picker vive dentro de uma `Table` com `overflow: hidden`, e o dropdown era
 * `position: absolute` — então era RECORTADO pelo ancestral: nas últimas linhas
 * (QA, SecOps) desaparecia por completo e não havia como selecionar modelo.
 * Agora ele é `fixed` e recebe coordenadas calculadas do retângulo do gatilho.
 */
function model(over: Partial<Model> = {}): Model {
  return {
    id: 'm-1',
    provider: 'ollama',
    name: 'llama3.2:1b',
    displayName: 'Llama 3.2 1B (local)',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    contextWindow: 8192,
    isActive: true,
    ...over,
  } as Model;
}

const MODELOS: ModelsByCategory = {
  local: {
    ollama: [
      model(),
      model({ id: 'm-2', name: 'qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B (local)' }),
    ],
  },
  cloud: {
    anthropic: [
      model({
        id: 'm-3',
        provider: 'anthropic',
        name: 'claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        inputPricePerMillionMicros: 5_000_000,
        outputPricePerMillionMicros: 25_000_000,
      }),
    ],
  },
} as ModelsByCategory;

function abrir(selectedModelId?: string) {
  const onSelect = vi.fn();
  render(
    <ModelPicker
      models={MODELOS}
      selectedModelId={selectedModelId}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Selecionar modelo|local|Claude/ }));
  return { onSelect };
}

describe('ModelPicker', () => {
  it('lista todos os modelos, locais e de cloud', () => {
    abrir();

    expect(screen.getByText('Llama 3.2 1B (local)')).toBeTruthy();
    expect(screen.getByText('Qwen2.5 Coder 7B (local)')).toBeTruthy();
    expect(screen.getByText(/Claude Opus 4.8/)).toBeTruthy();
    expect(screen.getByText('Local · Ollama')).toBeTruthy();
    expect(screen.getByText('Cloud · por provedor')).toBeTruthy();
  });

  it('o dropdown recebe coordenadas próprias, sem depender do ancestral', () => {
    // É isto que faz ele escapar do `overflow: hidden` da Table: a posição vem
    // do retângulo do gatilho, não do fluxo do container.
    const { container } = render(
      <ModelPicker models={MODELOS} onSelect={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar modelo' }));

    const dropdown = container.querySelector('[style*="top"]') as HTMLElement;
    expect(dropdown).toBeTruthy();
    expect(dropdown.style.top).not.toBe('');
    expect(dropdown.style.left).not.toBe('');
    expect(dropdown.style.maxHeight).not.toBe('');
  });

  it('escolher um modelo chama onSelect e fecha', () => {
    const { onSelect } = abrir();

    fireEvent.click(screen.getByText('Qwen2.5 Coder 7B (local)'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-2' }),
    );
    expect(screen.queryByText('Local · Ollama')).toBeNull();
  });

  it('marca o modelo vigente', () => {
    abrir('m-2');

    // O vigente aparece na lista; o gatilho mostra o nome dele.
    expect(screen.getAllByText('Qwen2.5 Coder 7B (local)').length).toBeGreaterThan(1);
  });

  it('Escape fecha sem selecionar', () => {
    const { onSelect } = abrir();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Local · Ollama')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicar fora fecha sem selecionar', () => {
    const { onSelect } = abrir();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('Local · Ollama')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('sem modelo cadastrado, diz isso em vez de abrir vazio', () => {
    render(
      <ModelPicker
        models={{ local: {}, cloud: {} } as ModelsByCategory}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar modelo' }));

    expect(screen.getByText('Nenhum modelo cadastrado')).toBeTruthy();
  });
});
