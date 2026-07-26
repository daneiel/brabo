/*
 * Previews do ModelPicker.
 *
 * `models` é ModelsByCategory = Record<'local'|'cloud', Record<string, Model[]>>
 * — categoria → provider → modelos. Os preços são em micro-USD por milhão de
 * tokens, então 3_000_000 é US$ 3,00/M.
 *
 * O catálogo inteiro só aparece no DROPDOWN, que vive em estado interno (`open`)
 * sem prop que o abra: um preview que só monta o componente mostra um chip e
 * nada mais, e a prop `models` fica sem efeito visível. Por isso o `Aberto`
 * clica no trigger depois do mount — é o único jeito de o card mostrar o que o
 * componente é. O trigger é o primeiro <button> do componente.
 */
import { useEffect, useRef } from 'react';
import { ModelPicker } from 'web';

type Modelos = Parameters<typeof ModelPicker>[0]['models'];

const noop = () => {};

const modelos = {
  local: {
    ollama: [
      {
        id: 'm-llama',
        provider: 'ollama',
        name: 'llama3.1:8b',
        displayName: 'Llama 3.1 8B',
        inputPricePerMillionMicros: 0,
        outputPricePerMillionMicros: 0,
        contextWindow: 131_072,
        isActive: true,
      },
      {
        id: 'm-qwen',
        provider: 'ollama',
        name: 'qwen2.5-coder:14b',
        displayName: 'Qwen2.5 Coder 14B',
        inputPricePerMillionMicros: 0,
        outputPricePerMillionMicros: 0,
        contextWindow: 32_768,
        isActive: true,
      },
    ],
  },
  cloud: {
    anthropic: [
      {
        id: 'm-opus',
        provider: 'anthropic',
        name: 'claude-opus-5',
        displayName: 'Claude Opus 5',
        inputPricePerMillionMicros: 15_000_000,
        outputPricePerMillionMicros: 75_000_000,
        contextWindow: 200_000,
        isActive: true,
      },
      {
        id: 'm-sonnet',
        provider: 'anthropic',
        name: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        inputPricePerMillionMicros: 3_000_000,
        outputPricePerMillionMicros: 15_000_000,
        contextWindow: 200_000,
        isActive: true,
      },
    ],
    openai: [
      {
        id: 'm-gpt',
        provider: 'openai',
        name: 'gpt-4.1',
        displayName: 'GPT-4.1',
        inputPricePerMillionMicros: 2_000_000,
        outputPricePerMillionMicros: 8_000_000,
        contextWindow: 1_047_576,
        isActive: true,
      },
    ],
  },
} as Modelos;

function Aberto({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** O catálogo aberto: local e nuvem, agrupados por provider, com preço. */
export function CatalogoAberto() {
  return (
    <Aberto>
      <ModelPicker models={modelos} selectedModelId="m-qwen" onSelect={noop} variant="topbar" />
    </Aberto>
  );
}

/** Só modelos locais — é o que aparece sem nenhuma chave de API configurada. */
export function SoLocaisAberto() {
  return (
    <Aberto>
      <ModelPicker
        models={{ local: modelos.local, cloud: {} } as Modelos}
        selectedModelId="m-llama"
        onSelect={noop}
        variant="standalone"
      />
    </Aberto>
  );
}

/** Fechado na topbar, com o modelo do projeto — o estado de repouso. */
export function FechadoNaTopbar() {
  return <ModelPicker models={modelos} selectedModelId="m-qwen" onSelect={noop} variant="topbar" />;
}

/** As três variantes de trigger, fechadas, e a última sem nada selecionado. */
export function VariantesDeTrigger() {
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <ModelPicker models={modelos} selectedModelId="m-opus" onSelect={noop} variant="topbar" />
      <ModelPicker models={modelos} selectedModelId="m-opus" onSelect={noop} variant="inline" />
      <ModelPicker models={modelos} onSelect={noop} variant="standalone" />
    </div>
  );
}
