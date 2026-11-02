import type { ButtonHTMLAttributes } from 'react';
import { Button as ShadcnButton } from '@/components/shadcn/button';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /**
   * Altura do botão. `md` (default) é o botão denso do produto, na faixa de
   * 28–36px que o handoff usa em barra de topo, tabela e diálogo; `lg` é o
   * botão de 44px que ele especifica para a AÇÃO PRINCIPAL de uma tela inteira
   * — hoje, o submit das quatro telas de auth.
   *
   * É prop separada de `fullWidth` de propósito, ainda que hoje as duas andem
   * juntas: largura e altura respondem a perguntas diferentes, e amarrar 44px a
   * `fullWidth` significaria que o primeiro botão largo fora de auth herda uma
   * altura que ninguém pediu.
   */
  size?: ButtonSize;
  /**
   * Botão QUADRADO só de ícone (o "botão de ícone" do handoff, raio `--r-sm`):
   * largura igual à altura do `size`. O nome acessível é do chamador —
   * `aria-label` —, porque um ícone não tem texto que o leitor de tela leia.
   *
   * `sm` (28px) é o botão DENSO de linha e painel lateral (paginador, idioma da
   * sessão, revogar numa tabela) — acima do piso de 24px que
   * `scripts/dev/validacao-visual.js` cobra.
   */
  icon?: boolean;
  /**
   * Ação em andamento: mostra o spinner, desabilita o botão e anuncia
   * `aria-busy` (ADR 0036).
   *
   * Antes cada tela fazia isso à mão — `disabled={enviando}` mais troca do
   * texto. Funcionava para quem vê, e não para quem não vê: sem `aria-busy` o
   * leitor de tela só percebia que o botão ficou desabilitado, sem dizer que
   * havia trabalho em curso.
   *
   * O `children` continua sendo do chamador, de propósito. O rótulo em
   * andamento é conteúdo ("Autenticando…", "Criando…", "Enviando…"), e é a tela
   * que sabe qual verbo cabe.
   */
  loading?: boolean;
}

const VARIANTE = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'destructive',
  success: 'success',
} as const;

// Adaptador (AT-646): o visual mora em `components/shadcn/button.tsx`.
export function Button({
  variant = 'primary',
  fullWidth,
  size = 'md',
  icon,
  loading,
  disabled,
  ...rest
}: ButtonProps) {
  const tamanho = icon
    ? size === 'sm'
      ? 'icon-sm'
      : 'icon'
    : size === 'md'
      ? 'default'
      : size;
  return (
    <ShadcnButton
      variant={VARIANTE[variant]}
      size={tamanho}
      fullWidth={fullWidth}
      loading={loading}
      data-variant={variant}
      data-size={size}
      data-icon={icon ? 'true' : undefined}
      data-full-width={fullWidth ? 'true' : undefined}
      // `loading` implica `disabled`: um botão que já disparou não pode disparar
      // de novo. `disabled` explícito continua valendo por si.
      disabled={disabled ?? loading}
      {...rest}
    />
  );
}
