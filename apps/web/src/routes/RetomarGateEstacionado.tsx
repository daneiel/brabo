import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mensagemDaApi, resumeParkedGate } from '../lib/api-client';
import type { SessionEvent } from '../lib/api-types';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import styles from './SessionPage.module.css';

/** O ciclo que um `gate.rescue_parked` estacionou, lido do payload. */
export function cicloEstacionado(evento: SessionEvent): { taskId: string; gate: string } | null {
  if (evento.type !== 'gate.rescue_parked') return null;
  const p = evento.payload as { taskId?: unknown; gate?: unknown } | null;
  if (typeof p?.taskId !== 'string' || typeof p?.gate !== 'string') return null;
  return { taskId: p.taskId, gate: p.gate };
}

interface Props {
  projectId: string;
  taskId: string;
  gate: string;
  /** Papel alcança o mínimo do endpoint (`developer`, `roleAtLeast`)? */
  podeDecidir: boolean;
}

/**
 * "Retomar gate" sob o aviso de ciclo estacionado (ADR 0207, RN-724). Sem
 * poll novo: o despacho do gate grava eventos no log da sessão, e o canal os
 * traz. A recusa (409 `gate_nao_estacionado`) vira toast com a frase da api.
 */
export function RetomarGateEstacionado({ projectId, taskId, gate, podeDecidir }: Props) {
  const { t } = useTranslation('sessionPage');
  const { showToast } = useToast();
  const [retomando, setRetomando] = useState(false);
  const [retomado, setRetomado] = useState(false);

  async function retomar() {
    setRetomando(true);
    try {
      await resumeParkedGate(projectId, taskId, gate);
      setRetomado(true);
    } catch (erro) {
      showToast({
        title: t('gateEstacionado.erroTitulo'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setRetomando(false);
    }
  }

  return (
    <div className={styles.mergearNoChat}>
      <Button
        variant="secondary"
        disabled={!podeDecidir || retomado}
        loading={retomando}
        onClick={() => void retomar()}
      >
        {t('gateEstacionado.botao')}
      </Button>
      <span className={styles.mergearNota} data-testid="retomar-gate-nota">
        {!podeDecidir
          ? t('gateEstacionado.semPapel')
          : retomado
            ? t('gateEstacionado.retomado')
            : t('gateEstacionado.nota', { gate })}
      </span>
    </div>
  );
}
