import { Ajuda } from '../components/ui/Ajuda';
import { Shimmer } from '../components/ui/Shimmer';
import { Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { CabecalhoDePagina } from '../components/shadcn/cabecalho-de-pagina';
import { SectionCards } from '../components/shadcn/section-cards';
import { Alert, AlertTexto } from '../components/shadcn/alert';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  getMySpend,
  getProject,
  getProjectBudget,
  setProjectBudget,
} from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { roleAtLeast } from '../lib/roles';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { hashtagDaSessao } from '../lib/session-label';
import { numberFmt } from '../lib/currency';
import type { BudgetPolicy } from '../lib/api-types';
import { alertaDeOrcamento } from '../lib/spend';
import { GastoPorDia } from '../components/GastoPorDia';
import { Ranking } from '../components/SpendCharts';
import { TokenMeter } from '../components/TokenMeter';
import { formatarUsd } from '../components/CredentialSpendSection';
import { GastoDoTimeNoProjeto, GastoDoWorkspace } from '../components/SpendPaineis';
import { comoRanking } from '../lib/spend-ranking';
import styles from './ProjectSpendTab.module.css';

/** Janela do relatório. Um mês é o ciclo em que uma fatura de LLM fecha. */
const DIAS = 30;

/**
 * A aba de Gastos — o mesmo gasto, para duas audiências (FASE 22, ADR 0063).
 *
 * O que ela mostra depende de QUEM olha, e não é preferência de layout:
 *
 * - o **owner** vê a conta do workspace inteiro. Onde o dinheiro foi (modelo,
 *   projeto, ator, dia) e, na seção que já existia, de que CHAVE saiu — a
 *   pergunta da fatura, que a RN-060 reserva a ele;
 * - o **membro** vê o que ELE consumiu neste projeto, em tokens e custo
 *   estimado. Sem provider e sem credencial: a chave que roda é a do owner
 *   (RN-058), e uma fatia de fatura alheia não é o que ele está perguntando.
 *
 * As duas leituras convivem porque nunca respondem a mesma coisa. O owner vê
 * as duas por ser a única pessoa que pode ver as duas.
 */
export function ProjectSpendTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const papel = useCurrentWorkspaceWithRole();

  // Ramificar antes de o papel chegar não é só um piscar de tela: `comPapel`
  // indefinido cairia na visão do membro e DISPARARIA a requisição dela, para
  // depois trocar tudo. Enquanto o papel é desconhecido não há pergunta a
  // fazer — e os três estados valem aqui também (RN-088).
  return (
    <div className={styles.pagina}>
      {papel.isLoading && (
        <div className={styles.estado}><Shimmer>{t('shared.loading')}</Shimmer></div>
      )}

      {papel.isError && (
        <Alert variant="danger" role="alert" className={styles.estadoErro}>
          <AlertTexto>{t('role.error')}</AlertTexto>
          <Button type="button" size="sm" onClick={() => papel.refetch()}>
            {t('shared.retry')}
          </Button>
        </Alert>
      )}

      {papel.data &&
        (papel.data.role === 'owner' ? (
          <GastoDoProjetoDoOwner projectId={projectId} />
        ) : (
          <>
            <GastoDoTimeNoProjeto projectId={projectId} />
            <MeuConsumo projectId={projectId} />
          </>
        ))}

      {/* O orçamento é do PROJETO, não da audiência — mostra para as duas
          quando o papel alcança (`maintainer`+). Fica silencioso em erro
          (403 de quem não é maintainer no projeto): pedir 403 de propósito
          é o mesmo ruído que a RN-060 já evita para a fatura do owner, e é o
          mesmo padrão do `TokenMeter` compacto em `ProjectPage.tsx`. */}
      {papel.data && (
        <OrcamentoDoProjeto
          projectId={projectId}
          podeEditar={roleAtLeast(papel.data.role, 'maintainer')}
        />
      )}
    </div>
  );
}

/**
 * O bloco "por projeto" (RN-212) — `TokenMeter` PLUGADO, não reimplementado.
 * `tokenThreshold` (`TokenMeter.tsx`) já faz 70/90 virar cor; este bloco só
 * alimenta o componente com o orçamento REAL do projeto.
 *
 * Três leituras, e SILENCIOSA na terceira: carregando (nada, evita piscar
 * antes do papel resolver a audiência de baixo), sem orçamento definido
 * (`data === null` — nota text, sem CTA: esta aba não navega para
 * Configurações), e erro — que aqui é quase sempre 403 de quem não é
 * `maintainer` no PROJETO (papel de WORKSPACE não implica papel de projeto),
 * e por isso não vira banner: seria alarme falso pra maioria dos membros.
 */
function OrcamentoDoProjeto({
  projectId,
  podeEditar,
}: {
  projectId: string;
  podeEditar: boolean;
}) {
  const { t } = useTranslation('spend');
  const budget = useQuery({
    queryKey: ['budget', projectId],
    queryFn: () => getProjectBudget(projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });

  // O editor aparece mesmo sem orçamento (é onde ele nasce) e mesmo sem papel
  // (inerte, com o motivo em texto — o papel lido é o do WORKSPACE, a lacuna
  // declarada de RN-471; quem recusa de verdade é a api).
  const editor = (
    <EditorDoOrcamento
      projectId={projectId}
      podeEditar={podeEditar}
      atual={budget.data ?? null}
    />
  );

  if (budget.isLoading) return null;
  if (budget.isError) return podeEditar ? editor : null;
  if (!budget.data) {
    return (
      <div className={styles.orcamentoProjeto}>
        <p className={styles.nota}>{t('budget.notSet')}</p>
        {editor}
      </div>
    );
  }

  const alerta = alertaDeOrcamento(budget.data);

  return (
    <div className={styles.orcamentoProjeto}>
      <TokenMeter
        unitLabel="USD"
        used={budget.data.spentMicros / 1_000_000}
        limit={budget.data.limitMicros / 1_000_000}
        costBRL={0}
        costUSD={budget.data.spentMicros / 1_000_000}
      />
      {alerta && (
        <Alert variant={alerta.nivel === 'danger' ? 'danger' : 'warning'} role="alert">
          <AlertTexto>{alerta.mensagem}</AlertTexto>
        </Alert>
      )}
      {editor}
    </div>
  );
}

/** Grava o teto do projeto (`PUT projects/:pid/budget`, `maintainer`). */
function EditorDoOrcamento({
  projectId,
  podeEditar,
  atual,
}: {
  projectId: string;
  podeEditar: boolean;
  atual: { limitMicros: number; policy: BudgetPolicy } | null;
}) {
  const { t } = useTranslation('spend');
  const qc = useQueryClient();
  const [limite, setLimite] = useState(atual ? String(atual.limitMicros / 1_000_000) : '');
  const [politica, setPolitica] = useState<BudgetPolicy>(atual?.policy ?? 'block');
  const [invalido, setInvalido] = useState(false);
  const salvar = useMutation({
    mutationFn: (limitUsd: number) => setProjectBudget(projectId, { limitUsd, policy: politica }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budget', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects-summary'] });
    },
  });

  return (
    <form
      className={styles.formulario}
      aria-label={t('budgetEditor.title')}
      onSubmit={(e) => {
        e.preventDefault();
        const valor = Number(limite.replace(',', '.'));
        if (!Number.isFinite(valor) || valor <= 0) {
          setInvalido(true);
          return;
        }
        setInvalido(false);
        salvar.mutate(valor);
      }}
    >
      <Input
        label={t('budgetEditor.limitLabel')}
        inputMode="decimal"
        value={limite}
        disabled={!podeEditar}
        onChange={(e) => setLimite(e.target.value)}
      />
      <div className={styles.grupoTeto}>
      <label className={styles.campo}>
        {t('budgetEditor.policyLabel')}
        <Select
          value={politica}
          disabled={!podeEditar}
          onChange={(e) => setPolitica(e.target.value as BudgetPolicy)}
        >
          <option value="block">{t('budgetEditor.block')}</option>
          <option value="allow">{t('budgetEditor.allow')}</option>
        </Select>
      </label>
      <div className={styles.acoes}>
        <Button
          type="submit"
          disabled={!podeEditar || salvar.isPending}
          legenda={salvar.isPending ? t('budgetEditor.saving') : t('budgetEditor.save')}
        >
          <Save aria-hidden="true" />
        </Button>
      </div>
      </div>
      {!podeEditar && <p className={styles.nota}>{t('budgetEditor.noRole')}</p>}
      {invalido && <Alert variant="danger" role="alert"><AlertTexto>{t('budgetEditor.invalid')}</AlertTexto></Alert>}
      {salvar.isError && <Alert variant="danger" role="alert"><AlertTexto>{t('budgetEditor.error')}</AlertTexto></Alert>}
      {salvar.isSuccess && <p className={styles.nota} role="status">{t('budgetEditor.saved')}</p>}
    </form>
  );
}

/** O owner na aba do projeto: SÓ este projeto (`?projectId=`, RN-952). */
function GastoDoProjetoDoOwner({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  return <GastoDoWorkspace workspaceId={project?.workspaceId} projectId={projectId} />;
}

/** A audiência do membro. */
function MeuConsumo({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const meu = useQuery({
    queryKey: ['my-spend', projectId, DIAS],
    queryFn: () => getMySpend(projectId, DIAS),
  });

  return (
    <>
      <CabecalhoDePagina
        titulo={
          <>
            {t('member.title')}
            <Ajuda assunto={t('member.title')}>
              <Trans i18nKey="member.subtitle" ns="spend" values={{ dias: DIAS }} components={{ strong: <strong /> }} />
              {' '}{t('member.note')}
            </Ajuda>
          </>
        }
        descricao={
          <Trans
            i18nKey="member.subtitleCurto"
            ns="spend"
            values={{ dias: DIAS }}
            components={{ strong: <strong /> }}
          />
        }
      />

      {meu.isLoading && (
        <div className={styles.estado}><Shimmer>{t('shared.summing')}</Shimmer></div>
      )}

      {meu.isError && (
        <Alert variant="danger" role="alert" className={styles.estadoErro}>
          <AlertTexto>{t('member.error')}</AlertTexto>
          <Button type="button" size="sm" onClick={() => meu.refetch()}>
            {t('shared.retry')}
          </Button>
        </Alert>
      )}

      {meu.data && (
        <>
          <SectionCards
            metricas={[
              {
                rotulo: t('member.estimatedLabel', { dias: DIAS }),
                valor: formatarUsd(meu.data.totalMicros),
                nota: t('member.callsDetail', {
                  count: meu.data.chamadas,
                  n: numberFmt.format(meu.data.chamadas),
                }),
              },
              {
                rotulo: t('member.tokensLabel'),
                valor: numberFmt.format(meu.data.inputTokens + meu.data.outputTokens),
                nota: t('shared.tokensDetail', {
                  input: numberFmt.format(meu.data.inputTokens),
                  output: numberFmt.format(meu.data.outputTokens),
                }),
              },
            ]}
          />

          <GastoPorDia
            serie={meu.data.porDia}
            titulo={t('member.dailySpendTitle')}
          />

          <Ranking
            titulo={t('member.bySessionTitle')}
            linhas={comoRanking(
              meu.data.porSessao,
              (l) => hashtagDaSessao(l.chave),
              t,
            )}
            vazio={t('member.bySessionEmpty')}
          />

        </>
      )}
    </>
  );
}
// ---------------------------------------------------------------------------
// KPI de economia com modelos locais — CORTE DECLARADO (RN-214).
//
// `TokenMeter` já tem `savingsBRL`/`savingsPct` prontos para receber o
// número, e não são alimentados aqui de propósito. O card do handoff
// (design_handoff_brabo) mostra algo como "economia de R$ 42 rodando
// qwen2.5-coder local em vez de um modelo pago" — e isso exige um preço
// CONTRAFACTUAL: quanto teria custado a MESMA chamada num modelo pago
// específico. Esse número não existe em lugar nenhum do produto hoje:
//   - o catálogo (ADR 0042) tem preço do modelo REALMENTE usado, congelado
//     em `token_usage` no instante da chamada (RN-044) — não tem um preço
//     "e se fosse outro modelo" para a MESMA chamada local;
//   - não há mapeamento declarado "modelo local X ~ modelo pago Y" em
//     lugar nenhum do domínio — inventá-lo aqui seria abrir uma tabela de
//     equivalência de qualidade sem base, a mesma classe de "nota vestida
//     de dado" que o RN-210 recusou para ranking de capacidade.
// Sem baseline real e versionado, o número seria inventado — a mesma
// classe de erro que a Onda 2/frente H2 já recusou para "recomendado"
// (RN-210) e que esta frente recusou para cor de provider (acima).
// Pendência registrada no backlog para quando existir preço contrafactual
// defensável (ex.: preço do catálogo do modelo pago mais barato que cobre
// a MESMA capacidade, congelado por decisão explícita — não calculado on
// the fly a cada render).
// ---------------------------------------------------------------------------
