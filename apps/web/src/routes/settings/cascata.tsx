import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { AGENTS } from '../../lib/agents';
import type {
  ModelBindingScope,
  ResolvedBinding,
  SkippedBinding,
} from '../../lib/api-types';
import { ORIGIN_TONE } from './shared';
import styles from '../ProjectSettingsTab.module.css';

/**
 * A cascata de modelo como CADEIA VISÍVEL, no lugar do enum cru.
 *
 * ## O que estava errado, e não era o resolver
 *
 * A coluna Origem imprimia `{resolved.origin}` — uma palavra em inglês, o nome
 * do enum do banco. Além de crua, ela CONFUNDIA dois estados que o produto
 * trata de formas diferentes, e os dois aparecem como `agent`:
 *
 * 1. **o agente tem binding próprio** — existe uma linha de escopo `agent` em
 *    `model_bindings` para ele;
 * 2. **a cascata pousou em `workspace` e o modelo foi HERDADO do Criativo** —
 *    não existe linha nenhuma para este agente.
 *
 * O segundo caso é `herdarModeloDeStart`
 * (`apps/api/src/domain/llm/binding-resolver.ts`), e a api está CERTA em
 * devolver `origin: 'agent'` ali: quem lê "de onde veio" precisa ver que veio
 * de um agente, e não de um escopo que não existe no banco. O que estava
 * errado era a TELA repetir o enum e parar aí — num projeto com 3 linhas de
 * `agent` no banco, os 12 agentes mostravam o mesmo `agent`.
 *
 * ## Como a cadeia distingue os dois
 *
 * Cada nível vira um nó com um dos quatro estados abaixo, e a cadeia inteira é
 * derivada NO CLIENTE, sem endpoint novo — `ModelsSection` já busca os quatro
 * níveis, e `AreaModelsSection` passou a buscar os dois que lhe faltavam.
 *
 * - `vigente` — é daqui que sai o modelo em uso (o único nó em `Badge`);
 * - `definido` — este nível TEM valor próprio, mas um mais específico venceu;
 * - `vazio` — nenhum valor neste nível;
 * - `pulado` — tinha valor e a cascata o descartou (`unavailable` /
 *   `sem_tool_calling`, Fase 9c). Era um segundo `Badge` de aviso ao lado da
 *   origem; virou um nó riscado DENTRO da cadeia, porque duas explicações da
 *   mesma descida competiam entre si.
 *
 * No caso 2 a cadeia fica visivelmente diferente da do caso 1: `agente` aparece
 * **vazio**, o nível que a cascata de fato alcançou (`workspace`) aparece
 * **definido** e não vigente — porque o modelo do workspace NÃO é o que vale —,
 * e um nó extra `↳ Criativo` fecha a cadeia como vigente. É o único nó que não
 * é escopo do banco, e é de propósito: ele nomeia o passo pós-cascata.
 *
 * ## O limite desta derivação, declarado
 *
 * Um caso fica indistinguível sem endpoint novo: agente COM linha própria
 * apontando exatamente para o mesmo modelo que o Criativo, num projeto sem
 * padrão de área nem de projeto. A cadeia o mostra como herdado. É por isso
 * que "voltar a herdar" continua aparecendo sempre que a origem é `agent` — a
 * ação segue disponível justamente no caso que a cadeia não consegue provar, e
 * nele ela ainda importa (apagar a linha muda o futuro: sem ela, o agente passa
 * a acompanhar o Criativo).
 */

/** Espelha `AGENTE_DE_START` de `apps/api/src/domain/llm/binding-resolver.ts`. */
export const AGENTE_DE_START = 'criativo';

/** O nó extra da cadeia: o passo pós-cascata, que não é escopo do banco. */
export type EscopoDaCadeia = ModelBindingScope | 'start';

export type EstadoDoNivel = 'vigente' | 'definido' | 'vazio' | 'pulado';

export interface NivelDaCadeia {
  escopo: EscopoDaCadeia;
  estado: EstadoDoNivel;
  /** O modelo daquele nível — entra no `title`, nunca no rótulo. */
  modelId?: string;
  /** Só em `pulado`. */
  motivo?: SkippedBinding['reason'];
}

/**
 * `start` reusa o tom de `agent` (`ORIGIN_TONE`) porque ele É um agente — o que
 * o distingue do nó `agente` é o RÓTULO (o nome do Criativo) e o fato de o nó
 * `agente` estar vazio ao lado dele, não uma sexta cor.
 */
const TOM_DO_NIVEL: Record<EscopoDaCadeia, BadgeTone> = {
  ...ORIGIN_TONE,
  start: ORIGIN_TONE.agent,
};

const CLASSE_DO_NIVEL: Record<EscopoDaCadeia, string> = {
  workspace: styles.nivelWorkspace,
  project: styles.nivelProject,
  area: styles.nivelArea,
  agent: styles.nivelAgent,
  session: styles.nivelAgent,
  start: styles.nivelAgent,
};

export interface EntradaDaCadeia {
  /** O que a api resolveu. `null`/`undefined` = nenhum nível tem modelo. */
  resolvido: ResolvedBinding | null | undefined;
  /** Os níveis desta cadeia, do mais GENÉRICO ao mais específico. */
  niveis: ModelBindingScope[];
  /**
   * O modelo PRÓPRIO de cada nível, quando o cliente consegue saber. Só é
   * consultado para níveis MAIS GENÉRICOS que o vencedor: dos mais específicos
   * a própria cascata já provou que estão vazios (senão teriam vencido).
   */
  proprios: Partial<Record<ModelBindingScope, string | undefined>>;
  /** `true` quando o valor vigente veio do passo pós-cascata do Criativo. */
  herdadoDoStart: boolean;
}

/**
 * Monta a cadeia. Pura — quem chama já tem os níveis em mãos.
 */
export function montarCadeia({
  resolvido,
  niveis,
  proprios,
  herdadoDoStart,
}: EntradaDaCadeia): NivelDaCadeia[] {
  const pulados = resolvido?.skipped ?? [];
  // Quando o Criativo entra, o nível que a CASCATA alcançou foi `workspace` —
  // `origin: 'agent'` ali é o passo de depois, não um degrau da descida.
  const vencedor = !resolvido
    ? undefined
    : herdadoDoStart
      ? 'workspace'
      : resolvido.origin;
  const iVencedor = vencedor ? niveis.indexOf(vencedor) : -1;

  const cadeia: NivelDaCadeia[] = niveis.map((escopo, i) => {
    const pulado = pulados.find((p) => p.scope === escopo);
    if (pulado) {
      return {
        escopo,
        estado: 'pulado',
        modelId: pulado.modelId,
        motivo: pulado.reason,
      };
    }
    if (i === iVencedor) {
      return {
        escopo,
        // Vencedor da cascata, mas NÃO o valor vigente: o modelo que vale é o
        // do Criativo. Marcá-lo `vigente` aqui afirmaria o modelo errado.
        estado: herdadoDoStart ? 'definido' : 'vigente',
        modelId: herdadoDoStart ? proprios[escopo] : resolvido?.modelId,
      };
    }
    // Mais específico que o vencedor: a cascata provou que está vazio.
    if (iVencedor >= 0 && i > iVencedor) return { escopo, estado: 'vazio' };
    const proprio = proprios[escopo];
    return proprio
      ? { escopo, estado: 'definido', modelId: proprio }
      : { escopo, estado: 'vazio' };
  });

  if (herdadoDoStart && resolvido) {
    cadeia.push({ escopo: 'start', estado: 'vigente', modelId: resolvido.modelId });
  }
  return cadeia;
}

/**
 * Herança do Criativo na cadeia de um AGENTE.
 *
 * A api não devolve essa informação (e não precisa: ver o comentário do topo),
 * então ela é DEDUZIDA do que já está em mãos. `origin: 'agent'` só pode ser
 * herança quando NENHUM nível acima do workspace tinha valor utilizável — se a
 * área ou o projeto tivessem, a cascata teria pousado neles e nunca chegaria a
 * `herdarModeloDeStart`. "Utilizável" exclui o que foi PULADO: um padrão de
 * área descartado por indisponibilidade não segura a descida.
 */
export function herdouDoCriativo(entrada: {
  agentKey: string;
  resolvido: ResolvedBinding | null | undefined;
  /** Binding RESOLVIDO da área do agente, se ele tiver área. */
  daArea: ResolvedBinding | null | undefined;
  /** Binding CRU do projeto (`null` quando o projeto só herda). */
  doProjeto: { modelId: string } | null | undefined;
  /** Binding RESOLVIDO do Criativo DESTE projeto. */
  doCriativo: ResolvedBinding | null | undefined;
}): boolean {
  const { agentKey, resolvido, daArea, doProjeto, doCriativo } = entrada;
  // Quem já É o Criativo não herda de si mesmo (mesma guarda do use case).
  if (agentKey === AGENTE_DE_START) return false;
  if (resolvido?.origin !== 'agent') return false;

  const pulou = (escopo: ModelBindingScope) =>
    (resolvido.skipped ?? []).some((p) => p.scope === escopo);
  if (daArea?.origin === 'area' && !pulou('area')) return false;
  if (doProjeto?.modelId && !pulou('project')) return false;

  // O passo do Criativo exige uma linha de agente DELE, utilizável — e é
  // exatamente isso que `origin: 'agent'` na resolução dele significa.
  return (
    doCriativo?.origin === 'agent' && doCriativo.modelId === resolvido.modelId
  );
}

function NoDaCadeia({
  nivel,
  rotuloExtra,
  nomeDoModelo,
}: {
  nivel: NivelDaCadeia;
  /** Rótulo do nó, quando o chamador sabe nomeá-lo (ex.: `área QA`). */
  rotuloExtra?: string;
  nomeDoModelo?: (modelId: string) => string | undefined;
}) {
  const { t } = useTranslation('settings');
  const rotulo =
    rotuloExtra ??
    (nivel.escopo === 'start'
      ? AGENTS[AGENTE_DE_START].name
      : t(`cascata.niveis.${nivel.escopo}`));
  // O `title` nomeia o MODELO daquele nível. O id cru é o último recurso, não o
  // primeiro: um UUID no tooltip não responde "qual modelo é esse".
  const modelo =
    (nivel.modelId ? nomeDoModelo?.(nivel.modelId) : undefined) ??
    nivel.modelId ??
    t('cascata.modeloDesconhecido');

  if (nivel.estado === 'vigente') {
    return (
      <Badge
        square
        tone={TOM_DO_NIVEL[nivel.escopo]}
        title={
          nivel.escopo === 'start'
            ? t('cascata.titulo.doStart', { modelo })
            : t('cascata.titulo.vigente', { modelo })
        }
      >
        {rotulo}
      </Badge>
    );
  }

  const titulo =
    nivel.estado === 'pulado'
      ? t(
          nivel.motivo === 'unavailable'
            ? 'cascata.titulo.puladoIndisponivel'
            : 'cascata.titulo.puladoSemToolCalling',
          { modelo },
        )
      : nivel.estado === 'definido'
        ? // Reusa o polo POSITIVO do vocabulário de valor herdado
          // (`settings/heranca.tsx`) — nível com valor próprio é a mesma ideia.
          t('cascata.titulo.definido', { polo: t('heranca.proprio'), modelo })
        : t('cascata.titulo.vazio', { polo: t('heranca.semValorProprio') });

  // Os três estados não-vigentes têm três aparências, e isso não é enfeite:
  // `definido` (tem valor, perdeu) e `vazio` (não tem valor) são a distinção
  // que a cadeia inteira existe para mostrar. Colapsá-los devolveria o problema
  // do enum cru num nível abaixo.
  const classes = [
    styles.nivel,
    CLASSE_DO_NIVEL[nivel.escopo],
    nivel.estado === 'pulado'
      ? styles.nivelPulado
      : nivel.estado === 'vazio'
        ? styles.nivelVazio
        : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} title={titulo}>
      {rotulo}
    </span>
  );
}

/**
 * A cadeia renderizada. `rotuloSemModelo` é o texto do caso em que NENHUM nível
 * tem valor — ele não é o mesmo nas duas seções que usam este componente, e não
 * deve ser: um agente sem modelo em nível nenhum e uma área sem padrão em nível
 * nenhum são vazios de coisas diferentes.
 */
export function CadeiaDeCascata({
  niveis,
  rotulos,
  nomeDoModelo,
  rotuloSemModelo,
  tituloSemModelo,
}: {
  niveis: NivelDaCadeia[];
  /** Rótulos que o chamador sabe nomear melhor que a chave genérica. */
  rotulos?: Partial<Record<EscopoDaCadeia, string>>;
  /** Id → nome de exibição, para os `title` dos nós. */
  nomeDoModelo?: (modelId: string) => string | undefined;
  rotuloSemModelo: string;
  tituloSemModelo: string;
}) {
  const semVigente = !niveis.some((n) => n.estado === 'vigente');
  return (
    <span className={styles.cadeia}>
      {niveis.map((nivel, i) => (
        <Fragment key={nivel.escopo}>
          {i > 0 && (
            <span className={styles.cadeiaSeta} aria-hidden="true">
              {nivel.escopo === 'start' ? '↳' : '›'}
            </span>
          )}
          <NoDaCadeia
            nivel={nivel}
            rotuloExtra={rotulos?.[nivel.escopo]}
            nomeDoModelo={nomeDoModelo}
          />
        </Fragment>
      ))}
      {semVigente && (
        <Badge square tone="muted" title={tituloSemModelo}>
          {rotuloSemModelo}
        </Badge>
      )}
    </span>
  );
}
