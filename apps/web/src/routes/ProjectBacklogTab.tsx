import { useState } from 'react';
import { useBacklog, useCoverage } from '../lib/hooks';
import type { Epic, Story, StoryStatus } from '../lib/api-types';
import { Badge, type BadgeTone } from '../components/ui/Badge';
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

export function ProjectBacklogTab({ projectId }: { projectId: string }) {
  const { data: epics } = useBacklog(projectId);
  const { data: coverage } = useCoverage(projectId);

  return (
    <div className={styles.wrapper}>
      <div className={styles.tree}>
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
      </button>
      {open && (
        <div className={styles.storyBody}>
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
