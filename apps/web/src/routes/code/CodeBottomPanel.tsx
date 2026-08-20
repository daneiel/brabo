import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContainerLifecycle } from '../../lib/api-client';
import { ErroDeCarregamento } from '../../components/ErroDeCarregamento';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { AlertIcon, OutputIcon } from '../../components/ui/icons';
import type { ContainerLifecycleStatus } from '../../lib/api-types';
import { CodeDiffPanel } from './CodeDiffPanel';
import { TerminalPanel } from './TerminalPanel';
import styles from './CodeBottomPanel.module.css';

type PainelInferior = 'terminal' | 'problems' | 'diff' | 'output';

const ABAS: { chave: PainelInferior; rotulo: string }[] = [
  { chave: 'terminal', rotulo: 'Terminal' },
  { chave: 'problems', rotulo: 'Problemas' },
  { chave: 'diff', rotulo: 'Diff de PR' },
  { chave: 'output', rotulo: 'Saída' },
];

const STATUS_LABEL: Record<ContainerLifecycleStatus, string> = {
  provisioning: 'Provisionando',
  running: 'Rodando',
  stopped: 'Parado',
  failed: 'Falhou',
  removed: 'Removido',
};

const STATUS_TONE: Record<ContainerLifecycleStatus, BadgeTone> = {
  provisioning: 'accent',
  running: 'success',
  stopped: 'muted',
  failed: 'danger',
  removed: 'muted',
};

/**
 * Painel inferior, as quatro abas do handoff (item 279 do
 * `design_handoff_brabo/README.md`): Terminal, Problemas, Diff e Saída.
 *
 * Só Diff tem dado real por trás (lista navegável de PRs — RN-111 — que abre
 * o diff por id ao clicar; quem já sabe o id continua podendo colar direto).
 * Terminal ganhou dado real nesta rodada (runner local + PTY interativo); as
 * outras duas seguem com estado vazio HONESTO, cada uma explicando por quê —
 * nenhuma decoração fingindo integração que não existe:
 *
 * - Terminal: interativo de VERDADE, via `TerminalPanel` — canal Phoenix
 *   `terminal:<projectId>` com um runner que o usuário roda na própria
 *   máquina (o lado servidor é frente PARALELA, em engine+api). Sem runner
 *   conectado, `TerminalPanel` mostra o terceiro estado da RN-088 com a
 *   instrução de como conectar um — não é erro genérico. O badge do ciclo de
 *   vida do CONTAINER (ADR 0081/0083, RN-267/268) continua ao lado: é outra
 *   informação (o container gerido pelo produto, distinto do runner na
 *   máquina do usuário), lido de `GET .../container/lifecycle` só enquanto
 *   esta aba está aberta — `null` é honesto, "nunca provisionado".
 * - Problemas: não há lint/diagnóstico algum rodando sobre o código do
 *   projeto gerido nesta aba — o badge "3" do handoff é mock. Inventar a
 *   contagem seria o mesmo erro que o ADR 0077 já recusou para nota de
 *   qualidade de modelo: número que não vem de medição real.
 * - Saída: não há stream de comando de build/deploy agregado nesta aba — o
 *   terminal interativo já tem a própria saída, dentro dele.
 */
export function CodeBottomPanel({ projectId }: { projectId: string }) {
  const [aba, setAba] = useState<PainelInferior>('terminal');

  const lifecycleQuery = useQuery({
    queryKey: ['container-lifecycle', projectId],
    queryFn: () => getContainerLifecycle(projectId),
    // Só busca enquanto a aba Terminal está aberta — nenhum orquestrador
    // real transiciona esta tabela hoje (RN-243), então reconsultar em
    // segundo plano seria tráfego sem informação nova (a mesma família de
    // defeito da PÓS-FASE 15).
    enabled: aba === 'terminal',
  });

  return (
    <div className={styles.painel}>
      <div className={styles.abas} role="tablist" aria-label="Painel inferior">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            role="tab"
            aria-selected={aba === item.chave}
            className={[styles.aba, aba === item.chave && styles.abaAtiva].filter(Boolean).join(' ')}
            onClick={() => setAba(item.chave)}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      <div className={styles.conteudo}>
        {aba === 'terminal' && (
          <div className={styles.terminalAba}>
            <div className={styles.cicloDeVidaFaixa}>
              {lifecycleQuery.isLoading && (
                <Skeleton width={180} height={20} radius={999} />
              )}

              {lifecycleQuery.isError && (
                <ErroDeCarregamento
                  titulo="Não consegui consultar o estado do container."
                  erro={lifecycleQuery.error}
                  onTentarDeNovo={() => void lifecycleQuery.refetch()}
                />
              )}

              {lifecycleQuery.isSuccess &&
                (lifecycleQuery.data ? (
                  <div className={styles.cicloDeVida}>
                    <Badge tone={STATUS_TONE[lifecycleQuery.data.status]}>
                      {STATUS_LABEL[lifecycleQuery.data.status]}
                    </Badge>
                    <span className={styles.cicloDeVidaDetalhe}>
                      desde{' '}
                      {new Date(lifecycleQuery.data.statusChangedAt).toLocaleString('pt-BR')}
                    </span>
                    {lifecycleQuery.data.status === 'failed' &&
                      lifecycleQuery.data.failureReason && (
                        <p className={styles.cicloDeVidaFalha}>
                          {lifecycleQuery.data.failureReason}
                        </p>
                      )}
                  </div>
                ) : (
                  <span className={styles.cicloDeVidaDetalhe}>
                    Container do projeto: nunca provisionado (RN-267).
                  </span>
                ))}
            </div>

            <div className={styles.terminalArea}>
              <TerminalPanel projectId={projectId} />
            </div>
          </div>
        )}
        {aba === 'problems' && (
          <div className={styles.terminalVazio}>
            <AlertIcon size={22} />
            <p>
              Não há lint nem testes integrados rodando sobre o código deste
              projeto — nenhuma ferramenta de análise estática hoje escaneia o
              repositório gerido. Mostrar uma contagem de erros ou avisos aqui
              seria decoração, não estado: quando essa integração existir, esta
              aba passa a listar diagnósticos reais.
            </p>
          </div>
        )}
        {aba === 'diff' && <CodeDiffPanel projectId={projectId} />}
        {aba === 'output' && (
          <div className={styles.terminalVazio}>
            <OutputIcon size={22} />
            <p>
              Não há stream de comando de build ou deploy AGREGADO nesta aba —
              o terminal interativo (aba Terminal) já tem a própria saída,
              dentro dele. `git push`, PR e deploy não saem pelo terminal de
              qualquer forma (RN-106): quando houver um pipeline de build ou
              deploy separado do terminal, a saída dele aparece aqui.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
