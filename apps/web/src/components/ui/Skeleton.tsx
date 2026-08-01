import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/**
 * Placeholder de carregamento — net-new, sem contraparte em `design/`
 * (nenhum dos mocks extraídos cobre estado de loading). Shimmer via
 * `--surface-1`/`--surface-2`, respeitando `prefers-reduced-motion` no
 * MESMO padrão do spinner de `Button` (ADR 0036): a animação para, o
 * elemento fica — sumir tiraria a informação "algo está carregando".
 */
export function Skeleton({ width = '100%', height = 16, radius = 6, className }: SkeletonProps) {
  return (
    <div
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius } as CSSProperties}
      data-testid="skeleton"
      aria-hidden="true"
    />
  );
}
