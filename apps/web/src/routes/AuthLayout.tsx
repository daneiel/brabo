import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

/**
 * A moldura das telas de auth (Fase 7a — o corte).
 *
 * `design/SCREENS.md` não tem mockup de login: o Keycloak servia essas telas,
 * então elas nunca foram desenhadas. A composição sai dos specs de base do
 * `design/COMPONENTS.md` (Inputs, Botões, Cards genéricos) e SÓ dos tokens
 * semânticos — nenhuma cor ou espaçamento inventado, que é regra explícita do
 * `design/README.md`.
 */
export function AuthLayout({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.tela}>
      <div className={styles.cartao}>
        <h1 className={styles.marca}>brabo</h1>
        <h2 className={styles.titulo}>{titulo}</h2>
        {children}
      </div>
    </main>
  );
}
