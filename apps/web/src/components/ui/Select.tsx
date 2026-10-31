import type { SelectHTMLAttributes } from 'react';
import { NativeSelect } from '@/components/shadcn/native-select';

// `size` (linhas visíveis) cede ao `size` sm/default do shadcn; ninguém o usa.
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>;

/** `<select>` nativo sobre `shadcn/native-select`; atributos do `<select>`. */
export function Select({ children, ...rest }: SelectProps) {
  return <NativeSelect {...rest}>{children}</NativeSelect>;
}
