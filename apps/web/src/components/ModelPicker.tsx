import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Model, ModelsByCategory } from '../lib/api-types';
import { ChevronDownIcon, ModelIcon } from './ui/icons';
import styles from './ModelPicker.module.css';

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

// Precisa casar com .dropdown no CSS — o cálculo de posição depende disso.
const DROPDOWN_WIDTH = 320;
const DROPDOWN_MAX_HEIGHT = 360;
const GAP = 6;
const MARGEM_VIEWPORT = 8;

function formatModelCost(model: Model): string {
  const avgMicros = (model.inputPricePerMillionMicros + model.outputPricePerMillionMicros) / 2;
  return `${usdFmt.format(avgMicros / 1_000_000)} /1M tok`;
}

interface ModelPickerProps {
  models: ModelsByCategory;
  selectedModelId?: string;
  onSelect: (model: Model) => void;
  variant?: 'topbar' | 'inline' | 'standalone';
}

function flatten(group: Record<string, Model[]> | undefined): Model[] {
  if (!group) return [];
  return Object.values(group).flat();
}

export function ModelPicker({ models, selectedModelId, onSelect, variant = 'standalone' }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const localModels = flatten(models.local);
  const cloudModels = flatten(models.cloud);
  const allModels = [...localModels, ...cloudModels];
  const selected = allModels.find((m) => m.id === selectedModelId);

  /**
   * O dropdown é `position: fixed` ancorado no gatilho, não `absolute` dentro
   * do wrapper.
   *
   * Motivo: o picker vive dentro de uma `Table`, que tem `overflow: hidden`
   * (necessário pro border-radius recortar as linhas). Um filho `absolute` era
   * RECORTADO por esse overflow — nas últimas linhas (QA, SecOps) o dropdown
   * abria pra baixo e sumia inteiro, tornando a seleção impossível. `fixed`
   * escapa do clipping do ancestral, e daí dá pra virar pra cima quando não há
   * espaço embaixo.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const gatilho = triggerRef.current?.getBoundingClientRect();
    if (gatilho) {
      const espacoAbaixo = window.innerHeight - gatilho.bottom - GAP - MARGEM_VIEWPORT;
      const espacoAcima = gatilho.top - GAP - MARGEM_VIEWPORT;
      const abreParaCima = espacoAbaixo < DROPDOWN_MAX_HEIGHT && espacoAcima > espacoAbaixo;
      const maxHeight = Math.max(120, Math.min(DROPDOWN_MAX_HEIGHT, abreParaCima ? espacoAcima : espacoAbaixo));

      setPosicao({
        top: abreParaCima ? gatilho.top - GAP - maxHeight : gatilho.bottom + GAP,
        // Não deixa vazar pela direita em tela estreita.
        left: Math.max(
          MARGEM_VIEWPORT,
          Math.min(gatilho.left, window.innerWidth - DROPDOWN_WIDTH - MARGEM_VIEWPORT),
        ),
        maxHeight,
      });
    }

    // Rolar/redimensionar descola o `fixed` do gatilho — fechar é mais honesto
    // que perseguir o elemento a cada frame.
    function fecha() {
      setOpen(false);
    }

    window.addEventListener('resize', fecha);
    window.addEventListener('scroll', fecha, true);
    return () => {
      window.removeEventListener('resize', fecha);
      window.removeEventListener('scroll', fecha, true);
    };
  }, [open]);

  // Fechar clicando fora e no Escape: sem isso o dropdown ficava aberto
  // indefinidamente — e agora que é `fixed`, sobreposto a qualquer coisa.
  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      const alvo = event.target as Element | null;
      if (wrapperRef.current?.contains(alvo as Node)) return;
      if (alvo?.closest?.(`.${styles.dropdown}`)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(model: Model) {
    onSelect(model);
    setOpen(false);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerIcon}>
          <ModelIcon size={14} />
        </span>
        {selected ? selected.displayName : 'Selecionar modelo'}
        {variant === 'topbar' && (
          <span className={styles.chevron}>
            <ChevronDownIcon size={13} />
          </span>
        )}
      </button>

      {open && posicao && (
        <div
          className={styles.dropdown}
          style={{ top: posicao.top, left: posicao.left, maxHeight: posicao.maxHeight }}
        >
          {allModels.length === 0 && (
            <div className={styles.groupHeader}>Nenhum modelo cadastrado</div>
          )}
          {localModels.length > 0 && (
            <>
              <div className={styles.groupHeader}>Local · Ollama</div>
              {localModels.map((model) => (
                <ModelOption key={model.id} model={model} selected={model.id === selectedModelId} onClick={() => pick(model)} />
              ))}
            </>
          )}
          {cloudModels.length > 0 && (
            <>
              <div className={styles.groupHeader}>Cloud · por provedor</div>
              {cloudModels.map((model) => (
                <ModelOption key={model.id} model={model} selected={model.id === selectedModelId} onClick={() => pick(model)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModelOption({ model, selected, onClick }: { model: Model; selected: boolean; onClick: () => void }) {
  const isFree = model.provider === 'ollama';
  return (
    <button type="button" className={[styles.option, selected && styles.selected].filter(Boolean).join(' ')} onClick={onClick}>
      <span className={[styles.radio, selected && styles.checked].filter(Boolean).join(' ')}>
        {selected && <span className={styles.radioDot} />}
      </span>
      <span className={styles.optionName}>
        {model.displayName}
        {!isFree && <span className={styles.optionProvider}> · {model.provider}</span>}
      </span>
      <span className={[styles.cost, isFree ? styles.costFree : styles.costPaid].join(' ')}>
        {isFree ? 'grátis' : formatModelCost(model)}
      </span>
    </button>
  );
}
