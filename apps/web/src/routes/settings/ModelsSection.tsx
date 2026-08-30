import type { CSSProperties } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  getProject,
  clearAgentModelBinding,
  getAgentModelBinding,
  getAreaModelBinding,
  getProjectAgentCosts,
  getProjectModelBinding,
  getWorkspaceModelBinding,
  listModels,
  mensagemDaApi,
  setAgentModelBinding,
} from '../../lib/api-client';
import { AGENT_LIST, AREAS, areaFor } from '../../lib/agents';
import type { Model, ModelBindingScope, ResolvedBinding } from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { ModelPicker } from '../../components/ModelPicker';
import { ClockIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/ToastProvider';
import { formatarCustoMicros } from './shared';
import styles from '../ProjectSettingsTab.module.css';
import { useVoltarAHerdar } from './heranca';
import {
  AGENTE_DE_START,
  CadeiaDeCascata,
  herdouDoCriativo,
  montarCadeia,
} from './cascata';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * Modelos por agente — a primeira seção do mockup (`design/SCREENS.md`).
 *
 * Cinco colunas, como no desenho: AGENTE, MODELO VIGENTE, ORIGEM, FALLBACK e
 * EST. MÊS. As duas últimas não existiam: `FALLBACK` é derivado aqui a partir
 * dos bindings de projeto e workspace, e `EST. MÊS` vem da rota de custo por
 * agente.
 */
// Exportada para o teste, como as demais seções.
export function ModelsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  // Só o VERBO do padrão de valor herdado (`settings/heranca.tsx`) — não a
  // `MarcaDeHeranca`. Nesta tabela a coluna ORIGEM já é a marca de estado da
  // linha, e um segundo enunciado do mesmo estado na mesma célula seria a
  // duplicação que este padrão remove.
  const { rotuloInline: voltarAHerdar } = useVoltarAHerdar();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: modelsByCategory } = useQuery({
    // A chave carrega o projeto porque a lista é do WORKSPACE dele (ADR 0049):
    // um cache global devolveria a curadoria de outro workspace.
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });

  const bindingQueries = useQueries({
    queries: AGENT_LIST.map((agent) => ({
      queryKey: ['agent-binding', projectId, agent.key],
      queryFn: () => getAgentModelBinding(projectId, agent.key),
    })),
  });

  // O padrão de cada ÁREA (ADR 0064, RN-102) — uma busca por área, não por
  // agente: lead e subagentes de uma mesma área compartilham a mesma pergunta.
  const areaKeys = Object.keys(AREAS);
  const areaBindingQueries = useQueries({
    queries: areaKeys.map((key) => ({
      queryKey: ['area-binding', projectId, key],
      queryFn: () => getAreaModelBinding(projectId, key),
    })),
  });
  const bindingDaAreaPorChave = new Map(
    areaKeys.map((key, index) => [key, areaBindingQueries[index]?.data]),
  );

  // Os dois níveis de cima da cascata, buscados UMA vez — é deles que sai a
  // coluna FALLBACK de todas as linhas.
  const { data: bindingDoProjeto } = useQuery({
    queryKey: ['project-model-binding', projectId],
    queryFn: () => getProjectModelBinding(projectId),
  });
  const { data: bindingDoWorkspace } = useQuery({
    queryKey: ['workspace-model-binding', project?.workspaceId],
    queryFn: () => getWorkspaceModelBinding(project!.workspaceId),
    enabled: Boolean(project?.workspaceId),
  });

  const { data: custos } = useQuery({
    queryKey: ['agent-costs', projectId],
    queryFn: () => getProjectAgentCosts(projectId),
  });

  const allModels: Model[] = modelsByCategory
    ? [...Object.values(modelsByCategory.local).flat(), ...Object.values(modelsByCategory.cloud).flat()]
    : [];

  // Modelo fora do catálogo do workspace ainda tem NOME: o id cru. Devolver
  // `undefined` ali fazia a coluna Fallback afirmar "não há nível abaixo" para
  // um nível que existe e só não é reconhecido.
  const nomeDoModelo = (modelId: string | undefined) =>
    modelId
      ? (allModels.find((m) => m.id === modelId)?.displayName ?? modelId)
      : undefined;

  // O Criativo é o agente de start (`herdarModeloDeStart`) — a resolução DELE
  // é o que diz se algum outro agente pode ter herdado o modelo dele.
  const resolvidoDoCriativo =
    bindingQueries[AGENT_LIST.findIndex((a) => a.key === AGENTE_DE_START)]?.data;

  /**
   * Os níveis que a cadeia de um agente percorre. `session` fica de fora: esta
   * tela é a configuração do agente NO PROJETO, não a de uma conversa — e o
   * endpoint que a alimenta resolve sem sessão (`agent-bindings/:slug`).
   */
  function cadeiaDoAgente(agentKey: string, resolvido: ResolvedBinding | null | undefined) {
    const areaDoAgente = areaFor(agentKey);
    const daArea = areaDoAgente
      ? bindingDaAreaPorChave.get(areaDoAgente.key)
      : undefined;
    const niveis: ModelBindingScope[] = areaDoAgente
      ? ['workspace', 'project', 'area', 'agent']
      : ['workspace', 'project', 'agent'];

    return montarCadeia({
      resolvido,
      niveis,
      proprios: {
        workspace: bindingDoWorkspace?.modelId,
        project: bindingDoProjeto?.modelId,
        // Só existe padrão PRÓPRIO de área quando a área não herdou o dela.
        area: daArea?.origin === 'area' ? daArea.modelId : undefined,
      },
      herdadoDoStart: herdouDoCriativo({
        agentKey,
        resolvido,
        daArea,
        doProjeto: bindingDoProjeto,
        doCriativo: resolvidoDoCriativo,
      }),
    });
  }

  /**
   * O que valeria se o binding vigente sumisse — a precedência é
   * `session > agent > area > project > workspace`
   * (`domain/llm/binding-resolver.ts`), então o fallback é o binding do nível
   * imediatamente inferior à origem resolvida. Origem `workspace` já é o
   * último nível: não há para onde cair.
   *
   * `area` entrou na FASE 23 (ADR 0064) ENTRE agente e projeto, e por isso
   * precisa do AGENTE da linha — áreas diferentes têm padrões diferentes, ao
   * contrário de projeto e workspace, que valem para a tabela inteira.
   */
  function fallbackDe(
    agentKey: string,
    origin: ResolvedBinding['origin'] | undefined,
  ) {
    const areaDoAgente = areaFor(agentKey);
    const bindingDaArea = areaDoAgente
      ? bindingDaAreaPorChave.get(areaDoAgente.key)
      : undefined;

    if (origin === 'session' || origin === 'agent') {
      return (
        nomeDoModelo(bindingDaArea?.modelId) ??
        nomeDoModelo(bindingDoProjeto?.modelId) ??
        nomeDoModelo(bindingDoWorkspace?.modelId)
      );
    }
    if (origin === 'area') {
      return (
        nomeDoModelo(bindingDoProjeto?.modelId) ??
        nomeDoModelo(bindingDoWorkspace?.modelId)
      );
    }
    if (origin === 'project') return nomeDoModelo(bindingDoWorkspace?.modelId);
    return undefined;
  }

  const custoPorAgente = new Map(
    (custos ?? []).map((c) => [c.actorId, c.costMicros]),
  );
  const custoTotalMicros = (custos ?? []).reduce(
    (soma, c) => soma + c.costMicros,
    0,
  );

  function invalidarBindingDoAgente(agentKey: string) {
    queryClient.invalidateQueries({ queryKey: ['agent-binding', projectId, agentKey] });
  }

  /**
   * Escolher o modelo de um agente — o `onSelect` do `ModelPicker` da coluna
   * MODELO VIGENTE.
   *
   * ## Por que aqui o 404 NÃO tem desfecho próprio, e na função irmã tem
   *
   * As duas funções são irmãs e a diferença é deliberada: quem ler as duas
   * lado a lado vai perguntar, e a resposta é o número de causas por status.
   *
   * O 404 do DELETE tem uma causa só, e por isso o cliente pôde nomeá-la. O
   * PUT deste endpoint recusa por SETE caminhos, e nenhum status identifica um
   * deles sozinho (`SetModelBindingUseCase` + `LlmBindingErrorFilter`):
   *
   * - **400** — `scope_id` malformado (`ScopeIdSemProjetoError`) ou `modelId`
   *   reprovado no DTO;
   * - **403** — papel abaixo de `developer` (`RolesGuard`);
   * - **404** — *duas* causas indistinguíveis pelo status: "Modelo não
   *   encontrado" e "Projeto não encontrado";
   * - **422** — *três* causas: o modelo não faz tool calling (RN-040), o owner
   *   desativou o modelo no workspace, ou ele sumiu do provider (RN-043) —
   *   ver `docs/business-rules/custo.md`.
   *
   * Traduzir esse 404 no cliente exigiria escolher UMA das duas frases e
   * acertar por sorte — seria a tela afirmando o que não sabe. E as recusas
   * que uma pessoa realmente alcança daqui são as de 422: o picker mostra o
   * modelo `unavailable` MARCADO em vez de escondê-lo (de propósito — um
   * modelo ausente da lista deixaria o binding que aponta para ele sem
   * explicação), e a lista é cacheada, então o modelo pode ter sido desligado
   * no catálogo depois do último `listModels`. Nesses casos a frase da api é a
   * informação mais útil que existe: ela nomeia o modelo e diz o que fazer.
   *
   * Então tudo aqui é falha de verdade e segue a gramática normal —
   * `mensagemDaApi` + tom `danger`, como em `AreaModelsSection.handleSet`.
   * Sem o `try/catch` isto virava `unhandled promise rejection`: a pessoa
   * escolhia um modelo, a tela não se mexia e o erro só existia no console.
   *
   * A linha só é relida no SUCESSO. Na recusa nada mudou no banco, e a coluna
   * MODELO VIGENTE continua exibindo o binding que a query trouxe — o
   * `ModelPicker` não guarda a escolha em estado local (`selected` sai do prop
   * `selectedModelId`), então não há valor recusado para desfazer. É o que a
   * RN-470 exige e o teste fixa: a tela nunca exibe um modelo que a api se
   * recusou a gravar.
   */
  async function handleModelChange(agentKey: string, model: Model) {
    try {
      await setAgentModelBinding(projectId, agentKey, model.id);
      invalidarBindingDoAgente(agentKey);
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('modelsSection.toast.setError')),
        tone: 'danger',
      });
    }
  }

  /**
   * "Voltar a herdar" (RN-102) — APAGA o binding do agente, nunca grava nele
   * o modelo da área: gravar viraria cópia, e a próxima mudança da área
   * deixaria este agente para trás em silêncio.
   *
   * ## Por que o 404 tem desfecho PRÓPRIO, e não o das outras falhas
   *
   * O botão aparece em TODA origem `agent` de propósito (RN-470): a cadeia do
   * cliente não consegue separar o agente com linha própria daquele que herdou
   * o modelo do Criativo, e continuar oferecendo a ação é o certo — no caso
   * indistinguível ela ainda muda o futuro. O preço é que, quando não havia
   * linha, a api responde 404 (`ClearModelBindingUseCase`), e ela está CERTA
   * em responder: "apaguei o que não existia" e "apaguei" são respostas
   * diferentes, e colapsá-las esconderia um `agentSlug` digitado errado.
   *
   * Só que, para quem clicou, esse 404 não é uma falha: o estado desejado — o
   * agente herda — já é verdade. Chamar de erro o que se pediu e já vale seria
   * a tela contradizendo o que ela sabe. Dois motivos para não mandar este 404
   * por `mensagemDaApi`, como as outras falhas:
   *
   * 1. a frase da api é pt-BR cravada no código e o idioma default do web é
   *    `en` (`lib/i18n.ts`) — repeti-la faria quem lê em inglês ler português;
   * 2. este endpoint tem UMA causa de 404 (papel insuficiente é 403 no
   *    `RolesGuard`, `scope_id` malformado não é 404), então o cliente SABE o
   *    que este 404 significa e pode dizer na língua de quem está lendo.
   *
   * Qualquer outro status continua sendo falha de verdade e vai por
   * `mensagemDaApi` + tom `danger`, como em `AreaModelsSection`. Nos DOIS
   * desfechos a query é invalidada: se a api diz que não havia linha, quem
   * está velha é a linha na tela, e reler é o que a conserta.
   */
  async function handleClearAgentBinding(agentKey: string, agentName: string) {
    try {
      await clearAgentModelBinding(projectId, agentKey);
      invalidarBindingDoAgente(agentKey);
      showToast({
        title: t('modelsSection.toast.reverted', { agent: agentName }),
        tone: 'success',
      });
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 404) {
        invalidarBindingDoAgente(agentKey);
        showToast({
          title: t('modelsSection.toast.alreadyInherits', { agent: agentName }),
          tone: 'accent',
        });
        return;
      }
      showToast({
        title: mensagemDaApi(erro, t('modelsSection.toast.clearError')),
        tone: 'danger',
      });
    }
  }

  // As proporções são as do handoff (seção 7, item 6): `1.4fr 1.9fr .8fr 1.4fr
  // .9fr`. Estavam próximas, não iguais, e a diferença aparecia na primeira
  // coluna — "Psicólogo (leve)" truncava em "Psicóo…".
  const columns: TableColumn<(typeof AGENT_LIST)[number]>[] = [
    {
      key: 'agent',
      // "Agente", e não "Agente · capacidades" como no desenho: as capacidades
      // exigidas por agente não existem no domínio, e prometer uma coluna que
      // não tem conteúdo é pior que não prometer.
      label: t('modelsSection.columns.agent'),
      width: '1.3fr',
      render: (agent) => (
        <span className={styles.agentCell}>
          <span className={styles.agentAvatar} style={{ ['--agent-color' as string]: agent.color } as CSSProperties}>
            {agent.initials}
          </span>
          {/* `title` porque a coluna ELIPSA por desenho: "QA de Performance e
              Segurança" cabe em 71px como "QA de Perf…", e sem o title o nome
              inteiro não existe em lugar nenhum da tela. */}
          <span className={styles.agentNome} title={agent.name}>
            {agent.name}
          </span>
        </span>
      ),
    },
    {
      key: 'model',
      label: t('modelsSection.columns.model'),
      width: '1.7fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        return modelsByCategory ? (
          <ModelPicker
            models={modelsByCategory}
            selectedModelId={resolved?.modelId}
            onSelect={(model) => handleModelChange(agent.key, model)}
            variant="inline"
          />
        ) : null;
      },
    },
    {
      key: 'origin',
      // Larga o suficiente para a CADEIA (`settings/cascata.tsx`) caber em uma
      // ou duas linhas. Era `0.8fr` quando a célula tinha uma palavra só; as
      // proporções do handoff descreviam aquela célula, não esta.
      label: t('modelsSection.columns.origin'),
      width: '1.75fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        const areaDoAgente = areaFor(agent.key);
        // `origin === 'agent'` é o agente DIVERGINDO — de uma área, quando ele
        // tem uma, ou do projeto/workspace, quando não tem (RN-102). Nos dois
        // casos "voltar a herdar" é apagar o binding dele, e é isso que o
        // botão faz — nunca copia o modelo do nível de baixo para cá.
        //
        // Ele continua aparecendo TAMBÉM quando a cadeia diz "herdado do
        // Criativo": é o único caso que a derivação do cliente não consegue
        // provar (ver `cascata.tsx`), e é justamente nele que a ação ainda
        // importa — apagar a linha faz o agente passar a acompanhar o Criativo.
        const divergiu = resolved?.origin === 'agent';
        return (
          <span className={styles.origem}>
            <CadeiaDeCascata
              niveis={cadeiaDoAgente(agent.key, resolved)}
              rotulos={
                areaDoAgente
                  ? { area: t('cascata.niveisComNome.area', { area: areaDoAgente.label }) }
                  : undefined
              }
              nomeDoModelo={nomeDoModelo}
              rotuloSemModelo={t('modelsSection.originChainNoModel')}
              tituloSemModelo={t('modelsSection.originChainNoModelTitle')}
            />
            {divergiu && (
              <button
                type="button"
                className={styles.voltarHerdar}
                onClick={() => handleClearAgentBinding(agent.key, agent.name)}
                title={
                  areaDoAgente
                    ? t('modelsSection.backToInheritTitleWithArea', {
                        area: areaDoAgente.label,
                      })
                    : t('modelsSection.backToInheritTitleNoArea')
                }
              >
                {voltarAHerdar}
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: 'fallback',
      label: t('modelsSection.columns.fallback'),
      width: '1.15fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        const nome = fallbackDe(agent.key, resolved?.origin);
        if (nome) return <span className={styles.fallback}>{nome}</span>;
        // Sem binding nenhum a coluna Origem já disse tudo — repetir a ausência
        // aqui seria um segundo enunciado do mesmo vazio.
        if (!resolved) return null;
        return (
          <span
            className={styles.vazioComTexto}
            title={t('modelsSection.fallbackNoneTitle')}
          >
            {t('modelsSection.fallbackNone')}
          </span>
        );
      },
    },
    {
      key: 'estimate',
      label: t('modelsSection.columns.estimate'),
      width: '0.85fr',
      render: (agent) => {
        const micros = custoPorAgente.get(agent.key);
        // Agente que nunca rodou não vem na resposta, e ausência é diferente de
        // zero: zero afirmaria um agente ativo e gratuito. O traço dizia as duas
        // com o mesmo símbolo; agora a ausência tem texto e o zero tem número.
        return micros === undefined ? (
          <span
            className={styles.estimativaVazia}
            title={t('modelsSection.noEstimateTitle')}
          >
            {t('modelsSection.noEstimateYet')}
          </span>
        ) : (
          <span className={styles.estimativa}>{formatarCustoMicros(micros)}</span>
        );
      },
    },
  ];

  return (
    <SecaoDeConfiguracoes chave="models">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('modelsSection.title')}</h2>
        <span className={styles.eyebrow}>{t('modelsSection.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {/* A legenda é a MESMA fonte de rótulos da cadeia da coluna Origem
            (`cascata.niveis.*`): a frase que explica a descida e os nós que a
            mostram linha a linha não podem chamar os níveis de nomes
            diferentes — era isso que fazia o enum cru em inglês parecer um
            terceiro vocabulário. */}
        {t('modelsSection.subtitle.intro')}{' '}
        <span className={`${styles.nivel} ${styles.nivelWorkspace}`}>
          {t('cascata.niveis.workspace')}
        </span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelProject}`}>
          {t('cascata.niveis.project')}
        </span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelArea}`}>
          {t('cascata.niveis.area')}
        </span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>
          {t('cascata.niveis.agent')}
        </span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>
          {t('cascata.niveis.session')}
        </span>.{' '}
        {t('modelsSection.subtitle.mostSpecificWins')}{' '}
        <strong>{t('modelsSection.subtitle.areaWord')}</strong>{' '}
        {t('modelsSection.subtitle.areaExplain')}{' '}
        <em>{t('modelsSection.subtitle.areaLink')}</em>
        {t('modelsSection.subtitle.below')}
      </p>

      <div className={styles.custoCard}>
        <ClockIcon size={15} className={styles.custoIcone} />
        <span className={styles.custoTexto}>
          {t('modelsSection.costCard.label')}{' '}
          <span className={styles.custoDetalhe}>{t('modelsSection.costCard.detail')}</span>
        </span>
        <span className={styles.custoValor}>
          {custos === undefined ? '—' : formatarCustoMicros(custoTotalMicros)}
        </span>
      </div>

      <Table
        columns={columns}
        rows={AGENT_LIST}
        rowKey={(a) => a.key}
        emptyMessage={t('modelsSection.emptyMessage')}
      />
      {allModels.length === 0 && (
        <div className={styles.subtitle}>{t('modelsSection.noModelsAvailable')}</div>
      )}
    </SecaoDeConfiguracoes>
  );
}
