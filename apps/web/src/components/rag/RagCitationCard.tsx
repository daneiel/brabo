import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { mensagemDaApi, sendRagFeedback } from '../../lib/api-client';
import type { RagSearchHit, RagVerdict } from '../../lib/api-types';
import { Badge, type BadgeTone } from '../ui/Badge';
import { FileIcon, SessionIcon } from '../ui/icons';
import styles from './RagCitationCard.module.css';

const CHAVE_DO_ESCOPO: Record<RagSearchHit['scope'], string> = {
  docs: 'ragCitation.scopeLabels.docs',
  adr: 'ragCitation.scopeLabels.adr',
  session: 'ragCitation.scopeLabels.session',
  local: 'ragCitation.scopeLabels.local',
};

const TOM_DO_ESCOPO: Record<RagSearchHit['scope'], BadgeTone> = {
  docs: 'muted',
  adr: 'accent',
  session: 'muted',
  local: 'accent',
};

/** `null` é "sinal não achou o chunk" (RN-234) — nunca confundir com 0%. */
function formatarSinal(valor: number | null): string {
  return valor === null ? '—' : `${Math.round(valor * 100)}%`;
}

/**
 * Uma citação da busca híbrida (RN-234, ADR 0080) — trecho, score e origem.
 *
 * O conteúdo é recortado visualmente (`line-clamp`) porque um chunk pode
 * chegar perto de 1200 caracteres (RN-235) e a lista de resultados não pode
 * virar uma parede de texto; "ver trecho completo" expande sem navegar.
 *
 * A origem de sessão navega até o EVENTO exato via `highlightEvent`, o
 * mesmo mecanismo que os chips de evidência do Psicólogo já usam
 * (`HypothesisCard.tsx`) — reuso, não invenção de um segundo caminho. A
 * origem de arquivo mostra caminho/seção como texto: a aba Código não tem
 * hoje como abrir num arquivo específico por deep-link (não é escopo desta
 * frente construir essa navegação).
 *
 * ## O voto nasce onde o número já está (RN-480)
 *
 * Este é o único lugar da UI que mostra `score`, `vectorScore` e
 * `lexicalScore` — então é aqui que o julgamento cabe. Os dois controles
 * (útil / irrelevante) são o único sinal de VERDADE da medição do RAG:
 * latência e taxa de degradação dizem se a busca RODOU, nunca se ela ACERTOU.
 *
 * Os três estados não colapsam (RN-088): enviando, registrado e recusado são
 * textos diferentes, e a recusa mostra a mensagem da api em vez de uma
 * constante — se o voto não foi gravado, a tela não pode dizer que foi.
 *
 * Sem `searchId` (a telemetria não foi gravada) os controles NÃO aparecem: o
 * voto seria recusado pela api, e oferecer um botão que não funciona é pior
 * que não oferecer nenhum.
 */
export function RagCitationCard({
  hit,
  projectId,
  searchId,
}: {
  hit: RagSearchHit;
  projectId: string;
  /** `null` = a busca não deixou linha de telemetria; não há a que anexar voto. */
  searchId?: string | null;
}) {
  const { t } = useTranslation('sessions');
  const [expandido, setExpandido] = useState(false);
  const navigate = useNavigate();

  const voto = useMutation({
    mutationFn: (verdict: RagVerdict) =>
      sendRagFeedback(projectId, { searchId: searchId!, chunkId: hit.chunkId, verdict }),
  });

  function irParaSessao() {
    if (hit.origin.kind !== 'session') return;
    navigate({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId, sessionId: hit.origin.sessionId },
      search: hit.origin.eventId ? { highlightEvent: hit.origin.eventId } : {},
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cabecalho}>
        <Badge tone={TOM_DO_ESCOPO[hit.scope]}>{t(CHAVE_DO_ESCOPO[hit.scope])}</Badge>
        <span className={styles.score} title={t('ragCitation.scoreTitle')}>
          {t('ragCitation.relevance', { score: formatarSinal(hit.score) })}
        </span>
        <span className={styles.sinais}>
          {t('ragCitation.signals', {
            vector: formatarSinal(hit.vectorScore),
            lexical: formatarSinal(hit.lexicalScore),
          })}
        </span>
      </div>

      <p className={expandido ? styles.conteudoExpandido : styles.conteudo}>{hit.content}</p>
      {hit.content.length > 240 && (
        <button type="button" className={styles.botaoExpandir} onClick={() => setExpandido((v) => !v)}>
          {expandido ? t('ragCitation.collapse') : t('ragCitation.expand')}
        </button>
      )}

      <div className={styles.origem}>
        {hit.origin.kind === 'file' ? (
          <span className={styles.origemFile} title={hit.origin.sourcePath}>
            <FileIcon size={13} />
            {hit.origin.sourcePath}
            {hit.origin.headingPath && hit.origin.headingPath.length > 0 && (
              <span className={styles.headingPath}>
                {' · '}
                {hit.origin.headingPath.join(' › ')}
              </span>
            )}
          </span>
        ) : (
          <button type="button" className={styles.origemSessao} onClick={irParaSessao}>
            <SessionIcon size={13} />
            {hit.origin.title ?? t('ragCitation.viewInSession')}
          </button>
        )}
      </div>

      {searchId && (
        <div className={styles.voto} role="group" aria-label={t('ragCitation.feedback.groupLabel')}>
          <span className={styles.votoPergunta}>{t('ragCitation.feedback.question')}</span>
          <button
            type="button"
            className={styles.votoBotao}
            disabled={voto.isPending}
            onClick={() => voto.mutate('util')}
          >
            {t('ragCitation.feedback.useful')}
          </button>
          <button
            type="button"
            className={styles.votoBotao}
            disabled={voto.isPending}
            onClick={() => voto.mutate('irrelevante')}
          >
            {t('ragCitation.feedback.irrelevant')}
          </button>

          {/* Os três estados, cada um com texto próprio (RN-088). */}
          {voto.isPending && (
            <span className={styles.votoEstado} role="status">
              {t('ragCitation.feedback.sending')}
            </span>
          )}
          {voto.isSuccess && !voto.isPending && (
            <span className={styles.votoEstado} role="status">
              {t('ragCitation.feedback.recorded', {
                verdict: t(`ragCitation.feedback.verdicts.${voto.data.verdict}`),
                rank: voto.data.rank,
              })}
            </span>
          )}
          {voto.isError && !voto.isPending && (
            <span className={styles.votoErro} role="alert">
              {mensagemDaApi(voto.error, t('ragCitation.feedback.errorDefault'))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
