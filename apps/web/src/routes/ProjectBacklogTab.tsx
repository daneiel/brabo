import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBacklog,
  useCoverage,
  useCurrentWorkspaceWithRole,
} from '../lib/hooks';
import {
  archiveStory,
  mensagemDaApi,
  promoteStories,
  returnStory,
  updateStoryTitle,
} from '../lib/api-client';
import { roleAtLeast } from '../lib/roles';
import { Input } from '../components/ui/Input';
import type { Epic, Story, StoryStatus } from '../lib/api-types';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
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

/**
 * Por que os controles de corrigir uma história (RN-727) ficam inertes — o
 * texto que a tela diz UMA vez, em vez de um tooltip em botão `disabled`.
 * `null` quando a pessoa pode editar e arquivar. A régua é a da api
 * (`recusaDeCorrecaoDeHistoria`): papel `developer` (o do endpoint), só
 * `draft`, e sem tarefa `in_progress`/`in_review`.
 */
export function motivoDeCorrecaoInerte(
  story: Pick<Story, 'status' | 'tasks'>,
  podeEscrever: boolean,
): { chave: string; count?: number } | null {
  if (!podeEscrever) return { chave: 'storyNode.inertRole' };
  if (story.status !== 'draft') return { chave: 'storyNode.inertStatus' };
  const emExecucao = story.tasks.filter(
    (t) => t.status === 'in_progress' || t.status === 'in_review',
  ).length;
  if (emExecucao > 0) {
    return { chave: 'storyNode.inertRunning', count: emExecucao };
  }
  return null;
}

export function ProjectBacklogTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('backlog');
  const { data: epics } = useBacklog(projectId);
  // RN-727: editar/arquivar pedem `developer` no ENDPOINT — o papel de
  // WORKSPACE, com a lacuna declarada da RN-471 (o de projeto pode sobrepor).
  const { data: workspaceComPapel } = useCurrentWorkspaceWithRole();
  const podeEscrever = roleAtLeast(workspaceComPapel?.role, 'developer');
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
          <EmptyState>{t('empty.epics')}</EmptyState>
        ) : (
          epics.map((epic) => (
            <EpicNode
              key={epic.id}
              epic={epic}
              projectId={projectId}
              podeEscrever={podeEscrever}
            />
          ))
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
          <EmptyState>{t('empty.rules')}</EmptyState>
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
          title: `${t('promotionQueue.toast.partialPromoted', {
            count: r.promoted.length,
          })}, ${t('promotionQueue.toast.partialFailed', { count: r.failed.length })}`,
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

function EpicNode({
  epic,
  projectId,
  podeEscrever,
}: {
  epic: Epic;
  projectId: string;
  podeEscrever: boolean;
}) {
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
            <StoryNode
              key={story.id}
              story={story}
              projectId={projectId}
              podeEscrever={podeEscrever}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryNode({
  story,
  projectId,
  podeEscrever,
}: {
  story: Story;
  projectId: string;
  podeEscrever: boolean;
}) {
  const { t } = useTranslation('backlog');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(story.title);
  const [arquivando, setArquivando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const inerte = motivoDeCorrecaoInerte(story, podeEscrever);

  async function aposCorrigir() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['coverage', projectId] }),
    ]);
  }

  async function salvarTitulo() {
    if (titulo.trim() === '' || ocupado) return;
    setOcupado(true);
    try {
      await updateStoryTitle(projectId, story.id, titulo.trim());
      setEditando(false);
      await aposCorrigir();
      showToast({ title: t('storyNode.toast.updated'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('storyNode.toast.updateError'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarArquivo() {
    if (ocupado) return;
    setOcupado(true);
    try {
      await archiveStory(projectId, story.id, motivo.trim() || undefined);
      setArquivando(false);
      await aposCorrigir();
      showToast({ title: t('storyNode.toast.archived'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('storyNode.toast.archiveError'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setOcupado(false);
    }
  }

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
        <span className={styles.count}>
          {t('storyNode.taskCount', { count: story.tasks.length })}
        </span>
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
          <div className={styles.storyActions}>
            <Button
              variant="ghost"
              disabled={inerte !== null || ocupado}
              onClick={() => {
                setTitulo(story.title);
                setEditando(true);
              }}
            >
              {t('storyNode.editTitle')}
            </Button>
            <Button
              variant="ghost"
              disabled={inerte !== null || ocupado}
              onClick={() => {
                setMotivo('');
                setArquivando(true);
              }}
            >
              {t('storyNode.archive')}
            </Button>
          </div>
          {inerte && (
            <p className={styles.inertReason}>
              {t(inerte.chave, { count: inerte.count })}
            </p>
          )}
        </div>
      )}

      {editando && (
        <Modal
          title={t('storyNode.editModalTitle')}
          onClose={() => setEditando(false)}
        >
          <Input
            label={t('storyNode.titleLabel')}
            value={titulo}
            maxLength={200}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="primary"
              loading={ocupado}
              disabled={titulo.trim() === ''}
              onClick={salvarTitulo}
            >
              {t('storyNode.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditando(false)}>
              {t('storyNode.cancel')}
            </Button>
          </div>
        </Modal>
      )}

      {arquivando && (
        <Modal
          title={t('storyNode.archiveModalTitle', { title: story.title })}
          onClose={() => setArquivando(false)}
        >
          <p className={styles.description}>
            {t('storyNode.archiveExplain', { count: story.tasks.length })}
          </p>
          <Textarea
            label={t('storyNode.archiveReasonLabel')}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t('storyNode.archiveReasonPlaceholder')}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={ocupado}
              onClick={confirmarArquivo}
            >
              {t('storyNode.archiveConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setArquivando(false)}>
              {t('storyNode.cancel')}
            </Button>
          </div>
        </Modal>
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
