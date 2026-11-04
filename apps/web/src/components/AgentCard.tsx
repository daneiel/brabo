import { Disclosure } from './ui/Disclosure';
import { useState, type CSSProperties } from 'react';
import { useCatalogoDeAgentes } from '../lib/agent-catalog-queries';
import { Hand, Plane, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentDef } from '../lib/agents';
import { BranchIcon, ModelIcon } from './ui/icons';
import { Badge } from './ui/Badge';
import { Button as BotaoDeIcone } from '@/components/ui/Button';
import { Card } from '@/components/shadcn/card';
import { Shimmer } from './ui/Shimmer';
import { OQueOPilotoLibera } from './OQueOPilotoLibera';
import styles from './AgentCard.module.css';

// `travado` (Fase 12b — RN-047): circuit breaker do dev agent disparado.
// A derivação real (dev.idle_tripped → travado) é da Fase 12b-7; o tipo e o
// botão de rearmar chegam antes, inertes, porque nada ainda produz esse
// status.
export type AgentStatus = 'trabalhando' | 'aguardando' | 'ocioso' | 'falhou' | 'travado';

// A CHAVE (namespace `executors`, `agentCard.status.<status>`) resolvida no
// render — texto de STATUS_COLOR é só cor, nunca precisa de tradução.
const STATUS_LABEL_KEY: Record<AgentStatus, string> = {
  trabalhando: 'agentCard.status.trabalhando',
  aguardando: 'agentCard.status.aguardando',
  ocioso: 'agentCard.status.ocioso',
  falhou: 'agentCard.status.falhou',
  travado: 'agentCard.status.travado',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  trabalhando: 'var(--success)',
  aguardando: 'var(--warning)',
  ocioso: 'var(--text-muted)',
  falhou: 'var(--danger)',
  travado: 'var(--danger)',
};

export type AutonomyMode = 'manual' | 'auto';

interface AgentCardProps {
  agent: AgentDef;
  status: AgentStatus;
  model?: { name: string; provider: string };
  autonomy?: AutonomyMode;
  onAutonomyChange?: (mode: AutonomyMode) => void;
  /**
   * Uma frase sob o toggle dizendo o que o "auto" LIBERA e o que continua
   * pedindo aprovação (RN-603). Quem decide se cabe é o chamador: só a
   * curinga `"*"` ligada é modo automático — o toggle sobre o tipo
   * representativo grava uma regra específica, que não libera o escopo.
   * Desde a RN-670 (ADR 0189) a frase vem com a lista inteira do piloto
   * (`OQueOPilotoLibera`, recolhida) — a mesma do `ApprovalCard` e dos
   * Executores.
   */
  autonomyHint?: string;
  /** Task/atividade corrente — o que o agente está fazendo AGORA. */
  activity?: { label: string; branch?: string };
  /** Custo acumulado do agente NESTA sessão, em micro-USD. */
  tokensMicros?: number;
  /** Selo curto ao lado do nome — hoje só "Lead" (área, Fase 8d). */
  badge?: string;
  /** Estilo reduzido pra card de subagente aninhado sob o lead da área. */
  compact?: boolean;
  /**
   * Rearma um dev agent travado pelo circuit breaker (Fase 12b — RN-047).
   * Só renderiza com `status === 'travado'` — é a ÚNICA saída de
   * `idle_tripped`, e a primeira ação do card condicionada a status (o
   * toggle de autonomia, a única precedente, aparece incondicional).
   */
  onRearm?: () => void;
  /** Liga as seções de instruções e ferramentas (AT-686); sem elas, o card fica como era. */
  projectId?: string;
  agentSlug?: string;
}

function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(4)}`;
}

export function AgentCard({
  agent,
  status,
  model,
  autonomy,
  onAutonomyChange,
  autonomyHint,
  activity,
  tokensMicros,
  badge,
  compact,
  onRearm,
  projectId,
  agentSlug,
}: AgentCardProps) {
  const { t } = useTranslation('executors');

  const Icon = agent.icon;
  const style = { ['--agent-color' as string]: agent.color } as CSSProperties;
  const statusStyle = { ['--status-color' as string]: STATUS_COLOR[status] } as CSSProperties;

  return (
    <Card padding="none" className={[styles.card, compact && styles.compact].filter(Boolean).join(' ')} style={style}>
      <div className={styles.top}>
        <div className={styles.avatar}>
          <Icon size={compact ? 16 : 20} />
        </div>
        <div className={styles.info}>
          <div className={styles.name}>
            {agent.name}
            {badge && (
              <Badge tone="agent" className={styles.badge}>
                {badge}
              </Badge>
            )}
          </div>
          <div className={styles.role}>{agent.role}</div>
          <span className={styles.status} style={statusStyle}>
            <span className={[styles.statusDot, status === 'trabalhando' && styles.pulsing].filter(Boolean).join(' ')} />
            {status === 'trabalhando' ? <Shimmer>{t(STATUS_LABEL_KEY[status])}</Shimmer> : t(STATUS_LABEL_KEY[status])}
          </span>
        </div>
      </div>

      {activity && (
        <div className={styles.activity}>
          <span className={styles.activityLabel} title={activity.label}>
            {activity.label}
          </span>
          {activity.branch && (
            <span className={styles.branch}>
              <BranchIcon size={11} />
              {activity.branch}
            </span>
          )}
        </div>
      )}

      {(model || tokensMicros !== undefined) && (
        <div className={styles.footer}>
          {model && (
            <span className={styles.model}>
              <span className={styles.modelIcon}>
                <ModelIcon size={13} />
              </span>
              {model.name} · {model.provider}
            </span>
          )}
          {tokensMicros !== undefined && (
            <span className={styles.tokens}>{formatMicros(tokensMicros)}</span>
          )}
        </div>
      )}

      {autonomy && onAutonomyChange && (
        <div className={styles.autonomy}>
          <BotaoDeIcone
            type="button"
            size="sm"
            variant={autonomy === 'manual' ? 'secondary' : 'ghost'}
            legenda={t('agentCard.autonomy.manual')}
            aria-pressed={autonomy === 'manual'}
            onClick={() => onAutonomyChange('manual')}
          >
            <Hand aria-hidden="true" />
          </BotaoDeIcone>
          <BotaoDeIcone
            type="button"
            size="sm"
            variant={autonomy === 'auto' ? 'secondary' : 'ghost'}
            legenda={t('agentCard.autonomy.auto')}
            aria-pressed={autonomy === 'auto'}
            onClick={() => onAutonomyChange('auto')}
          >
            <Plane aria-hidden="true" />
          </BotaoDeIcone>
        </div>
      )}
      {autonomy && onAutonomyChange && autonomyHint && (
        <>
          <p className={styles.autonomyHint}>{autonomyHint}</p>
          <OQueOPilotoLibera recolhido />
        </>
      )}

      {status === 'travado' && onRearm && (
        <div className={styles.autonomy}>
          <BotaoDeIcone type="button" variant="secondary" legenda={t('agentCard.rearm')} onClick={onRearm}>
            <RotateCcw aria-hidden="true" />
          </BotaoDeIcone>
        </div>
      )}
      {projectId && agentSlug && <CatalogoDoAgente projectId={projectId} slug={agentSlug} />}
    </Card>
  );
}

// Filho à parte: a query só existe quando o card tem projeto.
function CatalogoDoAgente({ projectId, slug }: { projectId: string; slug: string }) {
  const { t } = useTranslation('executors');
  const [abertas, setAbertas] = useState(false);
  // Só busca quando uma seção é aberta; as demais leem o mesmo cache.
  const catalogo = useCatalogoDeAgentes(projectId, abertas);
  return (
    <div className={styles.catalog}>
      {(['instructions', 'tools'] as const).map((secao) => (
        <Disclosure
          key={secao}
          titulo={t(`agentCard.catalog.${secao}`)}
          onAlternar={(aberto) => aberto && setAbertas(true)}
        >
          <SecaoDoCatalogo secao={secao} slug={slug} query={catalogo} />
        </Disclosure>
      ))}
    </div>
  );
}

function SecaoDoCatalogo({
  secao,
  slug,
  query,
}: {
  secao: 'instructions' | 'tools';
  slug: string;
  query: ReturnType<typeof useCatalogoDeAgentes>;
}) {
  const { t } = useTranslation('executors');
  if (query.isError) return <p>{t('agentCard.catalog.error')}</p>;
  if (!query.data) return <p aria-busy="true">{t('agentCard.catalog.loading')}</p>;
  // Os dev-<modulo> usam a entrada `dev-*` do catálogo.
  const a = query.data.agentes.find((x) => x.agente === slug) ??
    (slug.startsWith('dev-') ? query.data.agentes.find((x) => x.agente === 'dev-*') : undefined);
  if (secao === 'tools') {
    if (!a?.ferramentas) return <p>{t('agentCard.catalog.toolsUnavailable')}</p>;
    if (a.ferramentas.length === 0) return <p>{t('agentCard.catalog.noTools')}</p>;
    return (
      <>
        <p>{t('agentCard.catalog.toolCount', { count: a.ferramentas.length })}. {t('agentCard.catalog.note')}</p>
        <ul className={styles.scroll}>
          {a.ferramentas.map((f) => (
            <li key={f.nome}>
              <code>{f.nome}</code> {f.descricao}
            </li>
          ))}
        </ul>
      </>
    );
  }
  const ins = a?.instrucoesDoProjeto;
  return (
    <>
      {a?.identidade ? <p>{a.identidade}</p> : a ? <p>{t('agentCard.catalog.instructionsUnavailable')}</p> : null}
      {ins ? (
        <>
          <p>{t('agentCard.catalog.projectInstruction', { versao: ins.versao })}</p>
          <pre className={styles.scroll}>{ins.conteudo}</pre>
          {ins.conteudoTotal !== undefined && (
            <p>{t('agentCard.catalog.missing', { count: ins.conteudoTotal - ins.conteudo.length })}</p>
          )}
        </>
      ) : (
        <p>{t('agentCard.catalog.noProjectInstruction')}</p>
      )}
    </>
  );
}
