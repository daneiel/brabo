import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listProjectInstructionVersions,
  rollbackInstruction,
} from '../../lib/api-client';
import { AGENT_LIST } from '../../lib/agents';
import { pollQueParaNoErro } from '../../lib/query-policy';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * Histórico de versões por arquivo de agente (Fase 4b), com diff de cada
 * versão contra a anterior e rollback de um clique. Rollback é operação
 * PRA FRENTE: grava uma versão nova com o conteúdo antigo.
 */
export function InstructionVersionsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Pergunta ao backend QUEM tem histórico, em vez de adivinhar pelo roster
  // estático: os dev agents são instanciados por módulo (`dev-api`), não
  // existem em AGENT_LIST, e eram justamente os invisíveis aqui.
  const { data: historico } = useQuery({
    queryKey: ['instruction-versions', projectId],
    queryFn: () => listProjectInstructionVersions(projectId),
    refetchInterval: pollQueParaNoErro(15000),
  });

  // Um clique é o que o enunciado pede — mas revertendo DUAS vezes por duplo
  // clique nascem duas versões. `revertendo` desabilita enquanto voa.
  const [revertendo, setRevertendo] = useState<string | null>(null);

  async function handleRollback(agent: string, version: number) {
    setRevertendo(`${agent}:${version}`);
    try {
      await rollbackInstruction(projectId, agent, version);
      await queryClient.invalidateQueries({
        queryKey: ['instruction-versions', projectId],
      });
      showToast({
        title: t('instructionVersions.toast.revertedTitle'),
        message: t('instructionVersions.toast.revertedMessage', { agent, version }),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('instructionVersions.toast.errorTitle'),
        message: t('instructionVersions.toast.errorMessage'),
        tone: 'danger',
      });
    } finally {
      setRevertendo(null);
    }
  }

  const withHistory = (historico ?? []).map((entry) => ({
    // `label` do roster quando o slug é conhecido; senão o próprio slug
    // (`dev-api` e afins não estão no roster e não podem virar "undefined").
    agent: {
      key: entry.agent,
      label: AGENT_LIST.find((a) => a.key === entry.agent)?.name ?? entry.agent,
    },
    versions: entry.versions,
  }));

  return (
    <SecaoDeConfiguracoes chave="instructions">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('instructionVersions.title')}</h2>
        <span className={styles.eyebrow}>{t('instructionVersions.eyebrow')}</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        {t('instructionVersions.subtitle')}
      </div>

      {withHistory.length === 0 ? (
        <div className={styles.subtitle}>{t('instructionVersions.emptyMessage')}</div>
      ) : (
        withHistory.map(({ agent, versions }) => (
          <div key={agent.key} className={styles.agentBlock}>
            <div className={styles.profileUser}>{agent.label}</div>
            {versions.map((version) => {
              const key = `${agent.key}:${version.version}`;
              const open = expanded === key;
              return (
                <div key={version.id}>
                  <div className={styles.versionRow}>
                    <span className={styles.versionNo}>v{version.version}</span>
                    {version.isCurrent && (
                      <Badge tone="success">{t('instructionVersions.current')}</Badge>
                    )}
                    {version.sourceHypothesisId && (
                      <Badge tone="accent">
                        {t('instructionVersions.hypothesis', {
                          id: version.sourceHypothesisId.slice(-8),
                        })}
                      </Badge>
                    )}
                    <span className={styles.versionNote}>
                      {version.note ?? '—'}
                    </span>
                    <button
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      {open
                        ? t('instructionVersions.hideDiff')
                        : t('instructionVersions.showDiff', {
                            additions: version.diff.additions,
                            deletions: version.diff.deletions,
                          })}
                    </button>
                    {!version.isCurrent && (
                      <Button
                        variant="secondary"
                        disabled={revertendo !== null}
                        onClick={() => handleRollback(agent.key, version.version)}
                      >
                        {revertendo === `${agent.key}:${version.version}`
                          ? t('instructionVersions.reverting')
                          : t('instructionVersions.revert')}
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className={styles.versionDiff}>
                      {version.diff.lines.map((line, i) => (
                        <div
                          key={i}
                          className={[
                            styles.diffLine,
                            line.kind === 'add' && styles.add,
                            line.kind === 'del' && styles.del,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className={styles.diffSign}>
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                          </span>
                          <span>{line.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </SecaoDeConfiguracoes>
  );
}
