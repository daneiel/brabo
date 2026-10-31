import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes do shadcn resolvendo conflitos do Tailwind (AT-645). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
