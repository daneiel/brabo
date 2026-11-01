import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mensagemDaApi, resumeInterruptedTurn } from '../lib/api-client';
import type { SessionEvent } from '../lib/api-types';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import styles from './SessionPage.module.css';

export const MOTIVO_TURNO_INTERROMPIDO = 'turno_interrompido_por_reinicio';

export interface PassoDoPlano {
  texto: string;
  estado: string;
}
export interface PlanoDoAgente {
  objetivo: string;
  passos: PassoDoPlano[];
}

const ehAgente = (e: SessionEvent, id: string) => e.actor.kind === 'agent' && e.actor.id === id;

/** O `agent.error` é de turno que o reinício matou? */
export function ehTurnoInterrompido(evento: SessionEvent): boolean {
  return (
    evento.type === 'agent.error' &&
    (evento.payload as { reason?: unknown } | null)?.reason === MOTIVO_TURNO_INTERROMPIDO
  );
}

/**
 * O cartão só vale enquanto nada seguiu o `agent.error`: nem retomada
 * (`agent.turn_resumed`, automática ou não) nem turno novo do mesmo agente.
 */
export function turnoInterrompidoPendente(events: SessionEvent[], erro: SessionEvent): boolean {
  if (!ehTurnoInterrompido(erro) || erro.actor.kind !== 'agent') return false;
  const id = erro.actor.id;
  return !events.some(
    (e) =>
      e.seq > erro.seq &&
      ehAgente(e, id) &&
      (e.type === 'agent.turn_resumed' ||
        (e.type === 'agent.status' &&
          (e.payload as { status?: unknown } | null)?.status === 'working')),
  );
}

/** O último `agent.plan` do agente antes do erro (o vigente). */
export function planoVigente(events: SessionEvent[], erro: SessionEvent): PlanoDoAgente | null {
  if (erro.actor.kind !== 'agent') return null;
  const id = erro.actor.id;
  const plano = events
    .filter((e) => e.type === 'agent.plan' && e.seq < erro.seq && ehAgente(e, id))
    .sort((a, b) => b.seq - a.seq)[0];
  const p = plano?.payload as { objetivo?: unknown; passos?: unknown } | undefined;
  if (typeof p?.objetivo !== 'string' || !Array.isArray(p.passos)) return null;
  const passos = p.passos.filter(
    (x): x is PassoDoPlano =>
      typeof (x as PassoDoPlano)?.texto === 'string' &&
      typeof (x as PassoDoPlano).estado === 'string',
  );
  return { objetivo: p.objetivo, passos };
}

/** `agent.turn_resumed` com `automatica: true`: vira linha discreta no fio. */
export const ehRetomadaAutomatica = (e: SessionEvent): boolean =>
  e.type === 'agent.turn_resumed' &&
  (e.payload as { automatica?: unknown } | null)?.automatica === true;

interface Props {
  projectId: string;
  sessionId: string;
  agent: string;
  plano: PlanoDoAgente | null;
  /** Papel EFETIVO alcança o mínimo do endpoint (`developer`, `roleAtLeast`)? */
  podeDecidir: boolean;
  /** Depois do aceite: acompanha o turno pelo log (nunca `finalizarTurnoDoAgente`). */
  acompanhar: (agent: string) => void;
}

/** "Retomar" sob o aviso de turno interrompido. A recusa (409) vira toast com a frase da api. */
export function RetomarTurnoInterrompido({
  projectId,
  sessionId,
  agent,
  plano,
  podeDecidir,
  acompanhar,
}: Props) {
  const { t } = useTranslation('sessionPage');
  const { showToast } = useToast();
  const [retomando, setRetomando] = useState(false);
  const [retomado, setRetomado] = useState(false);

  async function retomar() {
    setRetomando(true);
    try {
      await resumeInterruptedTurn(projectId, sessionId, agent);
      setRetomado(true);
      acompanhar(agent);
    } catch (erro) {
      showToast({
        title: t('turnoInterrompido.erroTitulo'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setRetomando(false);
    }
  }

  const emCurso = plano?.passos.find((p) => p.estado === 'em_curso');
  return (
    <div data-testid="turno-interrompido">
      {plano && (
        <div className={styles.mergearNota} data-testid="turno-interrompido-plano">
          <div>{t('turnoInterrompido.objetivo', { objetivo: plano.objetivo })}</div>
          {emCurso && <div>{t('turnoInterrompido.pareiEm', { passo: emCurso.texto })}</div>}
          <ul>
            {plano.passos.map((p, i) => (
              <li key={i}>
                {t(`turnoInterrompido.estado.${p.estado}`, { defaultValue: p.estado })} · {p.texto}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.mergearNoChat}>
        <Button
          variant="secondary"
          disabled={!podeDecidir || retomado}
          loading={retomando}
          onClick={() => void retomar()}
        >
          {t('turnoInterrompido.botao')}
        </Button>
        <span className={styles.mergearNota} data-testid="retomar-turno-nota">
          {!podeDecidir
            ? t('turnoInterrompido.semPapel')
            : retomado
              ? t('turnoInterrompido.retomado')
              : t('turnoInterrompido.nota')}
        </span>
      </div>
    </div>
  );
}
