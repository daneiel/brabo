import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getSessionTokenUsage } from '../lib/api-client';
import { Context } from '../components/ai-elements/context';

/**
 * Quanto da janela do modelo o agente DESTINATÁRIO ocupa (AT-654, RN-969):
 * `input_tokens` da última chamada dele contra o `context_window` daquele
 * modelo. A MESMA queryKey de `session-destinatario.ts`, sem poll próprio —
 * nenhuma requisição nova. Sem chamada, sem destinatário ou 403: nada aparece.
 */
export default function JanelaDoAgente({
  projectId,
  sessionId,
  agente,
}: {
  projectId: string;
  sessionId: string;
  agente: string | null | undefined;
}) {
  const { t } = useTranslation('shell');
  const { data } = useQuery({
    queryKey: ['session-token-usage', projectId, sessionId],
    queryFn: () => getSessionTokenUsage(projectId, sessionId),
  });
  const ultima = agente ? data?.find((a) => a.actorId === agente)?.lastCall : null;
  if (!ultima) return null;
  const { inputTokens, contextWindow, modelName } = ultima;
  return (
    <Context
      usados={inputTokens}
      janela={contextWindow}
      rotulo={t('contexto.rotulo', {
        usados: inputTokens.toLocaleString(),
        janela: (contextWindow ?? 0).toLocaleString(),
        modelo: modelName,
      })}
      textoSemJanela={t('contexto.semJanela', { modelo: modelName })}
    >
      <span data-testid="janela-do-agente">
        {contextWindow && contextWindow > 0
          ? `${Math.min(100, Math.round((inputTokens / contextWindow) * 100))}%`
          : '—'}
      </span>
    </Context>
  );
}
