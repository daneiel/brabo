import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelPicker } from './ModelPicker';
import type { Model, ModelsByCategory } from '../lib/api-types';

/**
 * O picker vive dentro de uma `Table` com `overflow: hidden`, e o dropdown era
 * `position: absolute` — então era RECORTADO pelo ancestral: nas últimas linhas
 * (QA, SecOps) desaparecia por completo e não havia como selecionar modelo.
 * Agora ele é `fixed` e recebe coordenadas calculadas do retângulo do gatilho.
 *
 * A Fase 9c acrescentou o reagrupamento por origem (Local · APIs diretas ·
 * Hubs), os selos de custo/janela/tool calling e o filtro "aptos para agentes".
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
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsReasoning: false,
    generatesImage: false,
    supportsVision: false,
    manualPricing: true,
    availability: 'available',
    lastSeenAt: null,
    ...over,
  };
}

const MODELOS: ModelsByCategory = {
  local: {
    ollama: [
      model(),
      model({
        id: 'm-2',
        name: 'qwen2.5-coder:7b',
        displayName: 'Qwen2.5 Coder 7B (local)',
      }),
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
        contextWindow: 200_000,
      }),
    ],
  },
} as ModelsByCategory;

function abrir(selectedModelId?: string, models: ModelsByCategory = MODELOS) {
  const onSelect = vi.fn();
  render(
    <ModelPicker
      models={models}
      selectedModelId={selectedModelId}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Selecionar modelo|local|Claude/ }),
  );
  return { onSelect };
}

describe('ModelPicker', () => {
  it('agrupa por ORIGEM: local, API direta e hub', () => {
    abrir();

    expect(screen.getByText('Llama 3.2 1B (local)')).toBeTruthy();
    expect(screen.getByText(/Claude Opus 4.8/)).toBeTruthy();
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.getByText('APIs diretas')).toBeTruthy();
    // Grupo sem membro não aparece — os hubs entram na Fase 9b.
    expect(screen.queryByText('Hubs')).toBeNull();
  });

  it('mostra entrada e saída SEPARADAS, não a média das duas', () => {
    abrir();

    // A média de 5 e 25 daria "$15", que não é o preço de nada.
    expect(screen.getByText('$5.00 / $25.00 por 1M')).toBeTruthy();
    expect(screen.getAllByText('grátis').length).toBe(2);
  });

  it('traz os selos de janela e de tool calling', () => {
    abrir();

    expect(screen.getByText('200k ctx')).toBeTruthy();
    expect(screen.getAllByText('tool calling').length).toBe(3);
  });

  it('o filtro "aptos para agentes" esconde o chat-only (RN-040)', () => {
    abrir(undefined, {
      local: {
        ollama: [
          model({ id: 'chat', displayName: 'Tagarela', supportsToolCalling: false }),
          model({ id: 'agente', displayName: 'Com ferramentas' }),
        ],
      },
      cloud: {},
    } as ModelsByCategory);

    expect(screen.getByText('Tagarela')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.queryByText('Tagarela')).toBeNull();
    expect(screen.getByText('Com ferramentas')).toBeTruthy();
  });

  it('modelo indisponível aparece MARCADO, nunca some', () => {
    // Se sumisse, o binding que aponta pra ele viraria um mistério na tela —
    // e trocá-lo é justamente o que a pessoa veio fazer (RN-043).
    abrir(undefined, {
      local: {
        ollama: [
          model({ id: 'sumiu', displayName: 'Sumiu do provider', availability: 'unavailable' }),
        ],
      },
      cloud: {},
    } as ModelsByCategory);

    expect(screen.getByText('Sumiu do provider')).toBeTruthy();
    expect(screen.getByText('indisponível no provider')).toBeTruthy();
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
    expect(screen.queryByText('Local')).toBeNull();
  });

  it('marca o modelo vigente', () => {
    abrir('m-2');

    // O vigente aparece na lista; o gatilho mostra o nome dele.
    expect(screen.getAllByText('Qwen2.5 Coder 7B (local)').length).toBeGreaterThan(1);
  });

  it('Escape fecha sem selecionar', () => {
    const { onSelect } = abrir();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Local')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicar fora fecha sem selecionar', () => {
    const { onSelect } = abrir();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('Local')).toBeNull();
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

  it('filtro que esconde tudo explica, em vez de parecer catálogo vazio', () => {
    render(
      <ModelPicker
        models={
          {
            local: { ollama: [model({ supportsToolCalling: false })] },
            cloud: {},
          } as ModelsByCategory
        }
        onSelect={vi.fn()}
        filtroDeAgentesPadrao
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar modelo' }));

    expect(screen.getByText(/Nenhum modelo faz tool calling nativo/)).toBeTruthy();
    expect(screen.queryByText('Nenhum modelo cadastrado')).toBeNull();
  });
  /**
   * O defeito: o listener de `scroll` era de CAPTURA e não olhava o alvo, então
   * rolar a própria lista a fechava — e a rolagem seguia para a página atrás.
   * Com `max-height` e mais modelos que cabem, os de baixo eram inalcançáveis.
   */
  it('rolar DENTRO da lista não fecha', () => {
    abrir();

    const grupo = screen.getByText('Local');
    const dropdown = grupo.closest('div[class*="dropdown"]');
    expect(dropdown).toBeTruthy();

    fireEvent.scroll(dropdown!);

    expect(screen.queryByText('Local')).toBeTruthy();
  });

  it('rolar a PÁGINA fecha — o `fixed` descola do gatilho', () => {
    abrir();

    fireEvent.scroll(document.body);

    expect(screen.queryByText('Local')).toBeNull();
  });
});
