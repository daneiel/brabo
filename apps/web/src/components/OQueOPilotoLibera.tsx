import { useTranslation } from 'react-i18next';
import styles from './OQueOPilotoLibera.module.css';

/**
 * O que o PILOTO AUTOMÁTICO libera e o que ele NÃO libera (RN-670, ADR 0189).
 *
 * UMA lista, nos TRÊS lugares onde o modo automático é ligado — o cartão de
 * lote dos Executores (RN-661), o botão do `ApprovalCard` e o toggle do card
 * do agente —, para que a mesma decisão não tenha três frases diferentes. A
 * metade do "não libera" é o texto que a RN-661 já tinha
 * (`autoModeTeam.notReleased.*`), reusado; a do "libera" nasceu com o piloto.
 *
 * `recolhido` põe a lista atrás de um `<details>`: no card do agente e no
 * `ApprovalCard` a frase curta já está à vista, e a lista inteira é o detalhe.
 */
export function OQueOPilotoLibera({ recolhido = false }: { recolhido?: boolean }) {
  const { t } = useTranslation('executors');

  const conteudo = (
    <div className={styles.listas}>
      <div data-testid="piloto-libera">
        <strong>{t('autoModeTeam.released.title')}</strong>
        <ul>
          <li>{t('autoModeTeam.released.commands')}</li>
          <li>{t('autoModeTeam.released.compound')}</li>
          <li>{t('autoModeTeam.released.commitBranch')}</li>
          <li>{t('autoModeTeam.released.alwaysAllow')}</li>
        </ul>
      </div>
      <div data-testid="modo-automatico-nao-libera">
        <strong>{t('autoModeTeam.notReleased.title')}</strong>
        <ul>
          <li>{t('autoModeTeam.notReleased.merge')}</li>
          <li>{t('autoModeTeam.notReleased.push')}</li>
          <li>{t('autoModeTeam.notReleased.privileged')}</li>
          <li>{t('autoModeTeam.notReleased.containerRemove')}</li>
          <li>{t('autoModeTeam.notReleased.instructionPatch')}</li>
          <li>{t('autoModeTeam.notReleased.parallelize')}</li>
          <li>{t('autoModeTeam.notReleased.deny')}</li>
        </ul>
        <span>{t('autoModeTeam.notReleased.turnOff')}</span>
      </div>
    </div>
  );

  if (!recolhido) return <div className={styles.caixa}>{conteudo}</div>;
  return (
    <details className={styles.caixa} data-testid="piloto-detalhe">
      <summary>{t('autoModeTeam.released.summary')}</summary>
      {conteudo}
    </details>
  );
}
