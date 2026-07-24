import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  icon?: ReactNode;
}

export function Input({ mono, icon, className, ...rest }: InputProps) {
  const classes = [styles.input, mono && styles.mono, icon && styles.withIcon, className]
    .filter(Boolean)
    .join(' ');

  if (!icon) {
    return <input className={classes} {...rest} />;
  }

  return (
    <div className={styles.wrapper}>
      <span className={styles.icon}>{icon}</span>
      <input className={classes} {...rest} />
    </div>
  );
}
