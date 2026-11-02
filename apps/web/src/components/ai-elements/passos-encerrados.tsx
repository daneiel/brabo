import { useTranslation } from 'react-i18next';
import type { PassoDeFerramenta } from '../../lib/passos-do-turno';
import { ChainOfThought } from './chain-of-thought';
import { Tool } from './tool';

/* RN-974: passos do turno ENCERRADO, recolhido; nunca os args (RN-096). */
export function PassosEncerrados({ passos }: { passos: PassoDeFerramenta[] }) {
  const { t } = useTranslation('sessionPage');
  return (
    <div data-testid="passos-do-turno-encerrado">
      <ChainOfThought
        titulo={t('turno.passosDoTurno')}
        contagem={t('turno.passosCount', { count: passos.length })}
      >
        {passos.map((f) => (
          <Tool
            key={f.id}
            titulo={f.tool}
            estado={f.ok ? undefined : 'error'}
            saida={f.ok ? f.resultado : undefined}
            erro={f.ok ? undefined : (f.resultado ?? t('turno.ferramentaFalhou'))}
            avisoDeTruncada={f.truncado ? t('turno.resultadoCortado') : undefined}
          />
        ))}
      </ChainOfThought>
    </div>
  );
}
