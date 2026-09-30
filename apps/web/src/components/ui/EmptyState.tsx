import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** A frase do vazio — o que É verdade para este vazio (RN-088/RN-454). */
  children: ReactNode;
  /** Ícone opcional, num quadrado acima da frase. */
  icone?: ReactNode;
  /** `sucesso` quando o vazio é a boa notícia ("nada pendente"). */
  tom?: 'neutro' | 'sucesso';
  /** O CTA do vazio, quando há o que fazer a partir dele. */
  acao?: ReactNode;
  className?: string;
}

/**
 * O estado vazio do design system (AT-327): caixa tracejada, centralizada,
 * frase em corpo secundário, ícone e CTA opcionais.
 *
 * A auditoria de 30/09 contou quatro formas para a mesma coisa — centralizado
 * sem caixa (Chat), texto solto à esquerda (Executores, Insights), caixa
 * tracejada (Backlog, Aprovações) e card com cadeado (Código). A caixa
 * tracejada venceu porque é a única que diz "aqui cabe algo e ainda não há",
 * em vez de parecer um parágrafo da tela.
 *
 * O componente não decide a frase: vazio por FILTRO e vazio por AUSÊNCIA, ou
 * pausado e ainda-não-analisado, continuam sendo frases diferentes, escolhidas
 * por quem chama. E ele não é erro nem carregando — os três estados da RN-088
 * seguem separados, cada um com o seu componente.
 */
export function EmptyState({ children, icone, tom = 'neutro', acao, className }: EmptyStateProps) {
  return (
    <div className={[styles.vazio, className].filter(Boolean).join(' ')} data-empty-state="">
      {icone && (
        <span className={[styles.icone, tom === 'sucesso' && styles.sucesso].filter(Boolean).join(' ')} aria-hidden="true">
          {icone}
        </span>
      )}
      <div className={styles.texto}>{children}</div>
      {acao && <div className={styles.acao}>{acao}</div>}
    </div>
  );
}
