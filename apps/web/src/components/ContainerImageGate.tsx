import { useTranslation } from 'react-i18next';
import { LockIcon } from './ui/icons';
import styles from './ContainerImageGate.module.css';

/**
 * O quarto estado da RN-107/RN-088 — nem carregando, nem erro (a api
 * respondeu CERTO), nem vazio (não falta dado, falta uma DECISÃO) —
 * extraído de `ProjectCodeTab.tsx` (FASE 26) para outras superfícies que
 * passam pelo MESMO portão (`ReadProjectCodeUseCase.alvo`, RN-105) reusarem
 * a mesma cara e o mesmo texto.
 *
 * Achado de uso: a aba PRs (`code/PrListAndDiff.tsx`) chamava
 * `getCodePullRequests`/`getCodeDiff` sem perguntar o estado do container
 * antes, e o 409 do portão caía no banner de erro genérico com "Tentar de
 * novo" — a afordância errada para um estado estável que só o Arquiteto
 * resolve, nunca uma retentativa. Detectar a causa é
 * `isContainerImageGateError` (`lib/api-client.ts`); este componente é só a
 * apresentação, sem opinião sobre COMO o chamador descobriu que está
 * bloqueado (pré-checagem, como a aba Code faz, ou reagindo ao 409 de uma
 * query que já ia rodar mesmo, como a aba PRs faz).
 */
export function ContainerImageGateNotice() {
  const { t } = useTranslation('code');
  return (
    <div className={styles.bloqueado} role="status">
      <span className={styles.bloqueadoIcone} aria-hidden="true">
        <LockIcon size={22} />
      </span>
      <h2 className={styles.bloqueadoTitulo}>
        {t('projectCodeTab.blocked.title')}
      </h2>
      <p className={styles.bloqueadoTexto}>
        {t('projectCodeTab.blocked.description')}
      </p>
      <p className={styles.bloqueadoNota}>{t('projectCodeTab.blocked.note')}</p>
    </div>
  );
}
