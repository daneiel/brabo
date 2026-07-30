import type { ReactNode } from 'react';
import { AlertCircleIcon, AlertIcon, CheckIcon } from './icons';
import styles from './Alert.module.css';

export type AlertTone = 'danger' | 'warning' | 'success' | 'accent';

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  /**
   * Ícone próprio. Por default o tom escolhe: `success` recebe o check, `danger`
   * o círculo de falha, e `warning`/`accent` o triângulo de atenção — a mesma
   * distinção que o mock faz entre "falhou" e "preste atenção".
   */
  icon?: ReactNode;
  /**
   * Papel de acessibilidade, e **precisa ser escolhido, não herdado do tom**
   * (ADR 0036).
   *
   * `alert` é uma live region assertiva: o leitor de tela interrompe o que
   * estiver falando para anunciar. Isso é certo para o resultado de uma ação que
   * o usuário acabou de disparar (credencial recusada) e errado para texto que
   * já estava na tela quando ela abriu (o aviso de migração) — ali viraria
   * interrupção sem causa.
   *
   * Há uma segunda razão, concreta: `LoginPage.test.tsx` afirma que o
   * `role="alert"` da tela **não** contém as palavras do aviso de migração. É
   * como o teste guarda a anti-enumeração — se o aviso entrasse na mesma live
   * region, o teste passaria a ler "migrada" dentro do alerta de credencial.
   *
   * Default `undefined`: sem papel nenhum. Quem quer anúncio pede.
   */
  role?: 'alert' | 'status';
  className?: string;
}

function IconeDoTom({ tone }: { tone: AlertTone }) {
  if (tone === 'success') return <CheckIcon size={15} />;
  if (tone === 'danger') return <AlertCircleIcon size={15} />;
  return <AlertIcon size={15} />;
}

/**
 * Bloco de aviso dentro da página (ADR 0036).
 *
 * Não existia: cada tela repetia a própria classe `.banner`/`.aviso`, com
 * espaçamento e borda ligeiramente diferentes em cada lugar. O `design/` também
 * não tinha anatomia de alerta — o precedente era o banner da tela de Aprovações
 * e a nota fixa sob o `ApprovalCard`.
 *
 * Não é `Toast`: aquele é transiente e flutua na viewport. Este ocupa espaço no
 * fluxo e fica.
 */
export function Alert({
  tone = 'warning',
  children,
  icon,
  role,
  className,
}: AlertProps) {
  const classes = [styles.alerta, styles[tone], className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role={role}>
      <span className={styles.icone} aria-hidden="true">
        {icon ?? <IconeDoTom tone={tone} />}
      </span>
      <div className={styles.texto}>{children}</div>
    </div>
  );
}
