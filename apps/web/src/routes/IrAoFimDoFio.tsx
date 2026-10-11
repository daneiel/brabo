import { useTranslation } from 'react-i18next';
import { useIrAoFimDoFio } from '../lib/session-rolagem';
import styles from './IrAoFimDoFio.module.css';

/**
 * Botão flutuante "ir ao fim" do fio (RN-836, AT-506). Mora no fim do
 * conteúdo, `sticky` no rodapé da área que rola: some no fim e só aparece
 * quando chegou conteúdo depois que a pessoa subiu.
 */
export function IrAoFimDoFio({ totalDeMensagens }: { totalDeMensagens: number }) {
  const { t } = useTranslation('sessionPage');
  const { ancoraRef, irAoFim, visivel, novas, aprovacao } = useIrAoFimDoFio(totalDeMensagens);
  const rotulo = aprovacao
    ? t('fio.irAoFim.aprovacao')
    : t('fio.irAoFim.novas', { count: novas });
  return (
    <div ref={ancoraRef} className={styles.ancora}>
      {visivel && (
        <button
          type="button"
          className={[styles.botao, aprovacao ? styles.aprovacao : ''].join(' ')}
          onClick={irAoFim}
          aria-label={t('fio.irAoFim.rotulo', { detalhe: rotulo })}
          data-testid="ir-ao-fim-do-fio"
          data-aprovacao={aprovacao ? 'sim' : undefined}
        >
          ↓ {rotulo}
        </button>
      )}
    </div>
  );
}
