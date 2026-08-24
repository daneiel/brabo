import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useBacklog, useCoverage } from '../lib/hooks';
import { promoteStories, returnStory } from '../lib/api-client';
import type { Epic, Story, StoryStatus } from '../lib/api-types';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Textarea } from '../components/ui/Textarea';
import { useToast } from '../components/ui/ToastProvider';
import {
  ChevronRightIcon,
  StackIcon,
  HypothesisIcon,
  CheckIcon,
} from '../components/ui/icons';
import styles from './ProjectBacklogTab.module.css';

const STATUS_TONE: Record<StoryStatus, BadgeTone> = {
  draft: 'muted',
  ready: 'accent',
  in_progress: 'warning',
  done: 'success',
};

const STATUS_LABEL_KEY: Record<StoryStatus, string> = {
  draft: 'statusLabel.draft',
  ready: 'statusLabel.ready',
  in_progress: 'statusLabel.inProgress',
  done: 'statusLabel.done',
};

/**
 * As histórias que o PO terminou e que aguardam a decisão do usuário (Fase 12c
 * — RN-048). `proposedReady` convive com `status: 'draft'`: é uma proposta,
 * não um estado, e por isso não entra em `STATUS_TONE`.
 */
export function aguardandoPromocao(epics: Epic[] | undefined): Story[] {
  if (!epics) return [];
  return epics.flatMap((e) => e.stories.filter((s) => s.proposedReady));
}

export function ProjectBacklogTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('backlog');
  const { data: epics } = useBacklog(projectId);
  const { data: coverage } = useCoverage(projectId);
  const propostas = aguardandoPromocao(epics);

  return (
    <div className={styles.wrapper}>
      <div className={styles.tree}>
        {propostas.length > 0 && (
          <PromotionQueue projectId={projectId} stories={propostas} />
        )}

        <div className={styles.sectionLabel}>{t('sectionLabel.backlog')}</div>
        {!epics || epics.length === 0 ? (
          <div className={styles.empty}>{t('empty.epics')}</div>
        ) : (
          epics.map((epic) => <EpicNode key={epic.id} epic={epic} />)
        )}
      </div>

      <aside className={styles.traceability}>
        <div className={styles.sectionLabel}>
          {t('sectionLabel.traceability')}
          {coverage && coverage.uncoveredCount > 0 && (
            <Badge tone="danger">
              {t('coverage.uncoveredBadge', { count: coverage.uncoveredCount })}
            </Badge>
          )}
        </div>
        {!coverage || coverage.rules.length === 0 ? (
          <div className={styles.empty}>{t('empty.rules')}</div>
        ) : (
          coverage.rules.map((r) => (
            <div
              key={r.ruleId}
              className={[styles.ruleCard, !r.covered && styles.uncovered]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.ruleTitle}>{r.title}</div>
              {r.covered ? (
                <div className={styles.ruleMeta}>
                  <CheckIcon size={12} />{' '}
                  {t('coverage.coveredBy', {
                    count: r.coveredByStoryIds.length,
                  })}
                </div>
              ) : (
                <Badge tone="danger">{t('coverage.uncovered')}</Badge>
              )}
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

/**
 * "Aguardando sua promoção" — o passo humano que a Fase 12c devolve ao
 * usuário. Enquanto uma história está aqui, NENHUMA tarefa dela é pegável por
 * dev agent nenhum; promover libera o lote de uma vez e acorda os agentes
 * ociosos do módulo (Fase 12b).
 *
 * A seleção em lote copia o `ProjectApprovalsTab` (Set imutável, barra de
 * seleção, invalidação da query) com UM desvio deliberado: `Promise.allSettled`
 * no lugar de `Promise.all`. Lá o primeiro erro aborta o lote e nem limpa a
 * seleção; aqui a resposta do servidor já é parcial por contrato (`promoted` e
 * `failed` convivem num 201), e engolir isso num throw perderia exatamente a
 * informação que o usuário precisa para agir.
 */
function PromotionQueue({
  projectId,
  stories,
}: {
  projectId: string;
  stories: Story[];
}) {
  const { t } = useTranslation('backlog');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recusando, setRecusando] = useState<Story | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function promover(ids: string[]) {
    if (ids.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      const r = await promoteStories(projectId, ids);
      setSelected(new Set());
      await invalidate();

      if (r.failed.length === 0) {
        showToast({
          title: t('promotionQueue.toast.promoted', { count: r.promoted.length }),
          tone: 'success',
        });
      } else {
        // O motivo da primeira falha vai no corpo: sem ele o usuário só sabe
        // que "não deu", e a causa mais comum (módulo que saiu do module_map
        // entre a proposta e a decisão) não é adivinhável.
        showToast({
          title: t('promotionQueue.toast.partial', {
            promoted: r.promoted.length,
            failed: r.failed.length,
          }),
          message: r.failed[0]?.reason,
          tone: 'warning',
        });
      }
    } catch {
      showToast({ title: t('promotionQueue.toast.promoteError'), tone: 'danger' });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarRecusa() {
    if (!recusando || motivo.trim() === '' || ocupado) return;
    setOcupado(true);
    try {
      await returnStory(projectId, recusando.id, motivo.trim());
      setRecusando(null);
      setMotivo('');
      await invalidate();
      showToast({ title: t('promotionQueue.toast.returnedSuccess'), tone: 'success' });
    } catch {
      showToast({ title: t('promotionQueue.toast.returnError'), tone: 'danger' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className={styles.promotion}>
      <div className={styles.sectionLabel}>
        {t('sectionLabel.promotionQueue')}
        <Badge tone="warning">{stories.length}</Badge>
      </div>
      <p className={styles.promotionHint}>{t('promotionQueue.hint')}</p>

      {selected.size > 0 && (
        <div className={styles.selectionBar}>
          <span>{t('promotionQueue.selectedCount', { count: selected.size })}</span>
          <Button
            variant="success"
            loading={ocupado}
            onClick={() => promover(Array.from(selected))}
          >
            {t('promotionQueue.promoteSelected')}
          </Button>
        </div>
      )}

      <div className={styles.proposals}>
        {stories.map((story) => (
          <div key={story.id} className={styles.proposal}>
            <label className={styles.proposalPick}>
              <input
                type="checkbox"
                checked={selected.has(story.id)}
                onChange={() => toggleSelect(story.id)}
                aria-label={t('promotionQueue.selectAria', { title: story.title })}
              />
            </label>
            <div className={styles.proposalBody}>
              <div className={styles.proposalTitle}>{story.title}</div>
              {story.description && (
                <p className={styles.description}>{story.description}</p>
              )}
              <FieldList label={t('fieldLabels.rf')} items={story.rf} />
              <FieldList label={t('fieldLabels.dor')} items={story.dor} />
              <FieldList label={t('fieldLabels.dod')} items={story.dod} />
              <div className={styles.ruleRefs}>
                {t('ruleRefs', { count: story.businessRuleIds.length })}
                {story.tasks.length > 0 &&
                  t('promotionQueue.taskRefsSuffix', { count: story.tasks.length })}
              </div>
            </div>
            <div className={styles.proposalActions}>
              <Button
                variant="success"
                disabled={ocupado}
                onClick={() => promover([story.id])}
              >
                {t('promotionQueue.promote')}
              </Button>
              <Button
                variant="ghost"
                disabled={ocupado}
                onClick={() => {
                  setRecusando(story);
                  setMotivo('');
                }}
              >
                {t('promotionQueue.reject')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {recusando && (
        <Modal
          title={t('promotionQueue.returnModalTitle', { title: recusando.title })}
          onClose={() => setRecusando(null)}
        >
          <Textarea
            label={t('promotionQueue.reasonLabel')}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            hint={t('promotionQueue.reasonHint')}
            placeholder={t('promotionQueue.reasonPlaceholder')}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={ocupado}
              disabled={motivo.trim() === ''}
              onClick={confirmarRecusa}
            >
              {t('promotionQueue.returnConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setRecusando(null)}>
              {t('promotionQueue.cancel')}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function EpicNode({ epic }: { epic: Epic }) {
  const { t } = useTranslation('backlog');
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.epic}>
      <button
        type="button"
        className={styles.epicHeader}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={[styles.chevron, open && styles.chevronOpen]
            .filter(Boolean)
            .join(' ')}
        >
          <ChevronRightIcon size={13} />
        </span>
        <StackIcon size={15} />
        <span className={styles.epicTitle}>{epic.title}</span>
        <span className={styles.count}>
          {t('epicNode.storyCount', { count: epic.stories.length })}
        </span>
      </button>
      {open && (
        <div className={styles.stories}>
          {epic.stories.map((story) => (
            <StoryNode key={story.id} story={story} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryNode({ story }: { story: Story }) {
  const { t } = useTranslation('backlog');
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.story}>
      <button
        type="button"
        className={styles.storyHeader}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={[styles.chevron, open && styles.chevronOpen]
            .filter(Boolean)
            .join(' ')}
        >
          <ChevronRightIcon size={12} />
        </span>
        <HypothesisIcon size={13} />
        <span className={styles.storyTitle}>{story.title}</span>
        <Badge tone={STATUS_TONE[story.status]}>
          {t(STATUS_LABEL_KEY[story.status])}
        </Badge>
        {/* Chip ADICIONAL, não substituto: `proposedReady` é uma proposta que
            convive com o status `draft`, não um estado da máquina. */}
        {story.proposedReady && (
          <Badge tone="warning">{t('storyNode.awaitingYou')}</Badge>
        )}
        {story.returnedReason && (
          <Badge tone="danger">{t('storyNode.returned')}</Badge>
        )}
      </button>
      {open && (
        <div className={styles.storyBody}>
          {story.returnedReason && (
            <p className={styles.returned}>
              <strong>{t('storyNode.youReturned')}</strong> {story.returnedReason}
            </p>
          )}
          {story.description && (
            <p className={styles.description}>{story.description}</p>
          )}
          <FieldList label={t('fieldLabels.rf')} items={story.rf} />
          <FieldList label={t('fieldLabels.rnf')} items={story.rnf} />
          <FieldList label={t('fieldLabels.dor')} items={story.dor} />
          <FieldList label={t('fieldLabels.dod')} items={story.dod} />
          <div className={styles.ruleRefs}>
            {t('ruleRefs', { count: story.businessRuleIds.length })}
          </div>
          {story.tasks.length > 0 && (
            <ul className={styles.tasks}>
              {story.tasks.map((task) => (
                <li key={task.id} className={styles.task}>
                  {task.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FieldList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <ul className={styles.fieldItems}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
