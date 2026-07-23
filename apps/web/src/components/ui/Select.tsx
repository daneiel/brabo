import type { SelectHTMLAttributes } from 'react';
import { ChevronDownIcon } from './icons';
import styles from './Select.module.css';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <div className={styles.wrapper}>
      <select className={[styles.select, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </select>
      <span className={styles.chevron}>
        <ChevronDownIcon size={14} />
      </span>
    </div>
  );
}
