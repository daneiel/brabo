import type { ReactNode } from 'react';
import styles from './Tabs.module.css';

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
