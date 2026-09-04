import { useTranslation } from 'react-i18next';
import { corDoAgente } from '../lib/agents';
import type { EstadoDaAtividadeDoTurno } from '../lib/atividade-do-turno';
import { AvatarDoAgente } from './ui/AvatarDoAgente';
import { Disclosure } from './ui/Disclosure';
import { ChatIcon, TerminalIcon } from './ui/icons';
import styles from './TurnActivityStrip.module.css';

interface TurnActivityStripProps {
  /** O estado corrente da faixa (peça B, `lib/atividade-do-turno.ts`). */
  estado: EstadoDaAtividadeDoTurno;
  /** Quem está falando — resolve avatar/cor pelas MESMAS funções que o
   *  resto da tela usa pra qualquer agente do roster (`lib/agents.ts`).
   *  `null` degrada pro fallback genérico (ModelIcon + `--accent`). */
  agente: string | null;
  /** Indicador de "pensando" (RN-131/156) — o MESMO timer de 5s que
   *  `SessionPage.tsx` já mantém; este componente nunca arma um próprio. */
  pensandoVisivel: boolean;
}

/**
 * A faixa de atividade do turno — narra em linguagem humana o que um agente
 * conversacional (Criativo, PO, Arquiteto, Dev Lead, UX Designer, Staff) está
 * fazendo ENQUANTO o turno roda, referência visual a linha de status do
 * Claude Code. Fica ACIMA do composer; a resposta completa só vira bolha no
 * fio depois que o turno termina (RN-096 continua valendo: nunca payload cru
 * de `tool.call`, só a frase já resolvida por `fraseDaFerramenta`).
 *
 * Renderiza SÓ quando há turno em curso — mas essa decisão é de QUEM MONTA
 * (`SessionPage.tsx`, condicionando a própria presença do componente na
 * árvore): aqui dentro a única decisão de "mostrar ou não" é entre a prévia
 * de UMA linha (o texto corrente, ou a última linha arquivada quando a
 * ferramenta acabou de arquivar o corrente) e "Pensando…", gated pelo MESMO
 * timer de 5s que o resto da tela já mantém — sem nenhuma das duas coisas
 * (turno começou agora mesmo, antes dos 5s), o componente não renderiza
 * NADA, o mesmo silêncio que a bolha antiga tinha antes do timer.
 */
export function TurnActivityStrip({ estado, agente, pensandoVisivel }: TurnActivityStripProps) {
  const { t } = useTranslation('sessionPage');

  const ultimaLinha = estado.linhas[estado.linhas.length - 1];
  // O corrente tem prioridade — é o dado mais recente, e RN-131 manda: texto
  // de verdade aparece na hora, nunca espera timer nenhum. Sem corrente,
  // degrada pra última linha arquivada (o que a ferramenta acabou de fazer).
  const previa = estado.corrente !== '' ? estado.corrente : (ultimaLinha?.texto ?? null);

  if (previa === null && !pensandoVisivel) return null;

  const linhasParaExpandir = [
    ...estado.linhas,
    ...(estado.corrente !== ''
      ? [{ tipo: 'narracao' as const, texto: estado.corrente }]
      : []),
  ];

  return (
    <div className={styles.faixa} style={corDoAgente(agente ?? undefined)}>
      <AvatarDoAgente id={agente ?? undefined} />
      <div className={styles.corpo}>
        <div className={styles.previa} title={previa ?? undefined}>
          {previa ?? t('turno.pensando')}
        </div>
        {linhasParaExpandir.length > 0 && (
          <Disclosure
            titulo={t('turno.passosDoTurno')}
            trailing={t('turno.passosCount', { count: linhasParaExpandir.length })}
            classNameCabecalho={styles.disclosureCabecalho}
          >
            <div className={styles.linhas}>
              {linhasParaExpandir.map((linha, indice) => (
                // Índice como key: as linhas não têm id próprio (narração
                // efêmera, nunca persistida) e a lista só cresce ao FIM.
                <div key={indice} className={styles.linha}>
                  {linha.tipo === 'ferramenta' ? (
                    <TerminalIcon size={12} className={styles.linhaIconeFerramenta} />
                  ) : (
                    <ChatIcon size={12} className={styles.linhaIconeNarracao} />
                  )}
                  <span>{linha.texto}</span>
                </div>
              ))}
            </div>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
