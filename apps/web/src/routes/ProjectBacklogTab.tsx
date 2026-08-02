import { useState } from 'react';
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

const STATUS_LABEL: Record<StoryStatus, string> = {
  draft: 'rascunho',
  ready: 'pronta',
  in_progress: 'em progresso',
  done: 'concluída',
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
  const { data: epics } = useBacklog(projectId);
  const { data: coverage } = useCoverage(projectId);
  const propostas = aguardandoPromocao(epics);

  return (
    <div className={styles.wrapper}>
      <div className={styles.tree}>
        {propostas.length > 0 && (
          <PromotionQueue projectId={projectId} stories={propostas} />
        )}

        <div className={styles.sectionLabel}>Backlog</div>
        {!epics || epics.length === 0 ? (
          <div className={styles.empty}>
            Nenhum épico ainda. Aceite o handoff do Criativo numa sessão para o
            PO gerar o backlog.
          </div>
        ) : (
          epics.map((epic) => <EpicNode key={epic.id} epic={epic} />)
        )}
      </div>

      <aside className={styles.traceability}>
        <div className={styles.sectionLabel}>
          Rastreabilidade
          {coverage && coverage.uncoveredCount > 0 && (
            <Badge tone="danger">{coverage.uncoveredCount} descoberta(s)</Badge>
          )}
        </div>
        {!coverage || coverage.rules.length === 0 ? (
          <div className={styles.empty}>Sem regras de negócio ainda.</div>
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
                  <CheckIcon size={12} /> coberta por {r.coveredByStoryIds.length}{' '}
                  história(s)
                </div>
              ) : (
                <Badge tone="danger">descoberta — sem história</Badge>
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
          title: `${r.promoted.length} história(s) promovida(s)`,
          tone: 'success',
        });
      } else {
        // O motivo da primeira falha vai no corpo: sem ele o usuário só sabe
        // que "não deu", e a causa mais comum (módulo que saiu do module_map
        // entre a proposta e a decisão) não é adivinhável.
        showToast({
          title: `${r.promoted.length} promovida(s), ${r.failed.length} recusada(s) pelo domínio`,
          message: r.failed[0]?.reason,
          tone: 'warning',
        });
      }
    } catch {
      showToast({ title: 'Não foi possível promover', tone: 'danger' });
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
      showToast({ title: 'História devolvida ao PO', tone: 'success' });
    } catch {
      showToast({ title: 'Não foi possível devolver', tone: 'danger' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className={styles.promotion}>
      <div className={styles.sectionLabel}>
        Aguardando sua promoção
        <Badge tone="warning">{stories.length}</Badge>
      </div>
      <p className={styles.promotionHint}>
        O PO terminou estas histórias e elas estão completas. Até você promover,
        nenhuma tarefa delas é pegável por um dev agent.
      </p>

      {selected.size > 0 && (
        <div className={styles.selectionBar}>
          <span>{selected.size} selecionada(s)</span>
          <Button
            variant="success"
            loading={ocupado}
            onClick={() => promover(Array.from(selected))}
          >
            Promover selecionadas
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
                aria-label={`Selecionar ${story.title}`}
              />
            </label>
            <div className={styles.proposalBody}>
              <div className={styles.proposalTitle}>{story.title}</div>
              {story.description && (
                <p className={styles.description}>{story.description}</p>
              )}
              <FieldList label="RF" items={story.rf} />
              <FieldList label="DoR" items={story.dor} />
              <FieldList label="DoD" items={story.dod} />
              <div className={styles.ruleRefs}>
                {story.businessRuleIds.length} regra(s) de negócio vinculada(s)
                {story.tasks.length > 0 &&
                  ` · ${story.tasks.length} tarefa(s) que ficam pegáveis`}
              </div>
            </div>
            <div className={styles.proposalActions}>
              <Button
                variant="success"
                disabled={ocupado}
                onClick={() => promover([story.id])}
              >
                Promover
              </Button>
              <Button
                variant="ghost"
                disabled={ocupado}
                onClick={() => {
                  setRecusando(story);
                  setMotivo('');
                }}
              >
                Recusar
              </Button>
            </div>
          </div>
        ))}
      </div>

      {recusando && (
        <Modal
          title={`Devolver "${recusando.title}" ao PO?`}
          onClose={() => setRecusando(null)}
        >
          <Textarea
            label="Motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            hint="Vai como mensagem fixada na sessão do PO. Diga o que falta — é com isto que ele reescreve a história."
            placeholder="Ex.: os critérios de aceite não cobrem a recusa do pagamento."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="danger"
              loading={ocupado}
              disabled={motivo.trim() === ''}
              onClick={confirmarRecusa}
            >
              Devolver ao PO
            </Button>
            <Button variant="ghost" onClick={() => setRecusando(null)}>
              Cancelar
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function EpicNode({ epic }: { epic: Epic }) {
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
        <span className={styles.count}>{epic.stories.length} história(s)</span>
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
          {STATUS_LABEL[story.status]}
        </Badge>
        {/* Chip ADICIONAL, não substituto: `proposedReady` é uma proposta que
            convive com o status `draft`, não um estado da máquina. */}
        {story.proposedReady && <Badge tone="warning">aguardando você</Badge>}
        {story.returnedReason && <Badge tone="danger">devolvida</Badge>}
      </button>
      {open && (
        <div className={styles.storyBody}>
          {story.returnedReason && (
            <p className={styles.returned}>
              <strong>Você devolveu ao PO:</strong> {story.returnedReason}
            </p>
          )}
          {story.description && (
            <p className={styles.description}>{story.description}</p>
          )}
          <FieldList label="RF" items={story.rf} />
          <FieldList label="RNF" items={story.rnf} />
          <FieldList label="DoR" items={story.dor} />
          <FieldList label="DoD" items={story.dod} />
          <div className={styles.ruleRefs}>
            {story.businessRuleIds.length} regra(s) de negócio vinculada(s)
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
