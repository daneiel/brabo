import type { ReactNode } from 'react';
import styles from './Tabs.module.css';

/**
 * Régua de abas do design system — `components/primitivas/Tabs` no bundle
 * (`ds-bundle/_ds_sync.json`), uma das 66 peças que o `BraboDS` gera A PARTIR
 * deste app.
 *
 * Desde o ADR 0126 ela não tem consumidor dentro de `apps/web`: o único era
 * `GroupedTabs`, e `GroupedTabs` era do `ProjectPage`, que passou a navegar
 * por um trilho vertical (`routes/ProjectRail.tsx`). Ela FICA — primitiva
 * genérica sem chamador é peça do sistema de design em estoque, não código
 * morto, e apagá-la mudaria o inventário do DS por um efeito colateral de
 * uma tela.
 */
export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  trailing?: ReactNode;
}

export function Tabs({ items, active, onChange, trailing }: TabsProps) {
  return (
    <div className={styles.list} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          className={[styles.tab, active === item.key && styles.active].filter(Boolean).join(' ')}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
        </button>
      ))}
      {trailing}
    </div>
  );
}
