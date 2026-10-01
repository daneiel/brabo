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
export type SuperficieDoPortao = 'code' | 'prs';

/**
 * AT-323 (RN-646): a aba PRs mostrava o texto da aba Código ("A aba Code
 * ainda não está liberada") — o bloqueio é REAL (a api passa a lista de PRs
 * pelo mesmo `portaoDoContainer`, medido em `read-project-code.use-case.ts`),
 * mas quem lê está na aba PRs e o título falava de outra aba, com um nome
 * ("Code") que nem é o do trilho ("Código"). `superficie` escolhe o texto de
 * QUEM está bloqueado; o nome das abas vem de `nav:tabs.*.label`, a MESMA
 * fonte do trilho, nunca de um literal no texto.
 */
export function ContainerImageGateNotice({
  superficie = 'code',
}: { superficie?: SuperficieDoPortao } = {}) {
  const { t } = useTranslation('code');
  const nomes = {
    aba: t('nav:tabs.code.label'),
    abaCodigo: t('nav:tabs.code.label'),
    abaPrs: t('nav:tabs.prs.label'),
  };
  const bloco = superficie === 'prs' ? 'projectCodeTab.blockedPrs' : 'projectCodeTab.blocked';
  return (
    <div className={styles.bloqueado} role="status" data-superficie={superficie}>
      <span className={styles.bloqueadoIcone} aria-hidden="true">
        <LockIcon size={22} />
      </span>
      <h2 className={styles.bloqueadoTitulo}>{t(`${bloco}.title`, nomes)}</h2>
      <p className={styles.bloqueadoTexto}>{t(`${bloco}.description`, nomes)}</p>
      <p className={styles.bloqueadoNota}>{t(`${bloco}.note`, nomes)}</p>
    </div>
  );
}
