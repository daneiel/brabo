import { useState } from 'react';
import type { Model, ModelsByCategory } from '../lib/api-types';
import { ChevronDownIcon, ModelIcon } from './ui/icons';
import styles from './ModelPicker.module.css';

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

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

  const localModels = flatten(models.local);
  const cloudModels = flatten(models.cloud);
  const allModels = [...localModels, ...cloudModels];
  const selected = allModels.find((m) => m.id === selectedModelId);

  function pick(model: Model) {
    onSelect(model);
    setOpen(false);
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)}>
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

      {open && (
        <div className={styles.dropdown}>
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
