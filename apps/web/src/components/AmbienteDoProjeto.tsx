import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMirrorState, getProject, listModels } from '../lib/api-client';
import type { ExecutionMode, MirrorState } from '../lib/api-types';
import { LinhaDeSinal } from './SinaisDoAmbiente';
import sinais from './SinaisDoAmbiente.module.css';

/** A chave de tradução de cada modo, no namespace `overview`. */
const CHAVE_DO_MODO: Record<ExecutionMode, string> = {
  container: 'ambiente.modos.container',
  mounted: 'ambiente.modos.mounted',
  runner: 'ambiente.modos.runner',
};

/**
 * Estado de ambiente DO PROJETO — a metade dos sinais que só existe depois do
 * login, e que por isso não cabe na tela de entrada.
 *
 * ## Por que estes dois sinais moram aqui, e não no topo
 *
 * Presença de runner é escopada a `{user_id, project_id}` e a contagem de
 * modelos locais vem de `projects/:projectId/models` (papel `viewer`): os dois
 * pedem identidade E projeto, então o lugar mais raso em que são verdade é a
 * página do projeto. Dentro dela, este bloco fica na coluna lateral da Visão
 * geral, e não na faixa do topo, por dois motivos.
 *
 * O primeiro é que o topo já carrega duas peças e as DUAS pedem decisão — o
 * chip "Precisa de você" e o `TokenMeter`. Estado de ambiente não pede
 * decisão nenhuma; um terceiro elemento informativo ao lado de dois
 * acionáveis dilui os dois que importam.
 *
 * O segundo é mais forte: quem quer saber se o runner está VIVO AGORA tem uma
 * resposta melhor a um clique de distância. A aba Código abre o socket de
 * verdade e, sem runner conectado, o `TerminalPanel` mostra o
 * `RunnerOnboardingPanel` — isso é conhecimento de primeira mão, do canal. Um
 * selo no topo do projeto, construído sobre um proxy mais fraco, competiria
 * com esse sinal e poderia CONTRADIZÊ-LO.
 *
 * ## O que "runner" diz aqui, e o que ele não diz
 *
 * O dado é `project.workspaceVerifiedAt` — o carimbo que o caso de uso
 * `ConfirmProjectWorkspaceUseCase` grava quando um runner conecta e confirma
 * o caminho da pasta (RN-423). É o MESMO campo que o engine usa como portão
 * (`terminal_executor.ex` recusa executar num projeto `runner` com
 * `workspace_verified_at` nulo), então é a definição do próprio produto de
 * "este projeto tem runner configurado".
 *
 * Ele NÃO é batimento. Duas razões, e as duas estão no texto que a tela
 * mostra: (1) ele diz que um runner confirmou a pasta um dia, não que há um
 * processo vivo agora; (2) reconectar reportando o MESMO caminho não regrava
 * o carimbo (é uma decisão explícita do caso de uso), então a data também não
 * é "a última vez que o runner apareceu". Por isso a linha diz "confirmada
 * em <data>" e nunca "de pé" — e a ressalva embaixo aponta a aba Código, que
 * é quem sabe do agora. Mesma disciplina que a pendência de arquitetura usou
 * ao tomar emprestado o `updatedAt` da história.
 *
 * A linha do runner só aparece em projeto no modo `runner`: nos outros dois
 * `workspaceVerifiedAt` é nulo por definição (a conversão de modo o zera,
 * RN-450) e uma linha "nunca confirmada" ali seria uma ausência inventada.
 *
 * ## O que a linha do ESPELHO diz (RN-517, ADR 0147 ponto 7)
 *
 * Ela só existe em projeto que TEM destino declarado (`mirrorPath`), pela
 * mesma razão da linha do runner logo acima: num projeto sem espelho, "nunca
 * sincronizou" seria uma ausência inventada — não há o que sincronizar.
 *
 * Os TRÊS estados da RN-088 têm três frases DIFERENTES, e nenhuma vira a
 * outra: "nunca sincronizou" (nenhuma rodada reportada), "sincronizou"
 * (com contagem, e o zero tem frase própria — "não havia nada a copiar" é um
 * desfecho, não um vazio) e "falhou" (com o erro nomeado na ressalva). Um
 * traço servindo às três seria a tela recusando nomear o que sabe (RN-470).
 *
 * Data ABSOLUTA com ressalva, nunca bolinha verde de "está de pé" — o mesmo
 * precedente de `workspaceVerifiedAt` acima: o carimbo diz que uma rodada
 * aconteceu, não que o espelho esteja sincronizado agora com o que mudou
 * desde então (o gatilho é um momento nomeado, o commit, não um watcher).
 * E quando o destino da última rodada difere do declarado hoje, a ressalva
 * DIZ isso: a concessão viaja no join e só muda quando o runner reconecta
 * (RN-516), então afirmar a data de ontem sobre a pasta de hoje seria a tela
 * mentindo por omissão.
 *
 * ## Requisições
 *
 * As duas primeiras consultas reusam as chaves que a página já usa:
 * `['project', id]` é a mesma de `ProjectPage` e `['models', id]` a mesma da
 * própria Visão geral — o TanStack devolve do cache. A terceira
 * (`['mirror-state', id]`) é uma chamada A MAIS, e ela só sai quando o
 * projeto tem destino: pendurar o estado do espelho na leitura de projeto
 * custaria uma consulta em toda tela que carrega um projeto, para um dado que
 * quase nenhuma delas mostra.
 */
export function AmbienteDoProjeto({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('overview');

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const modelsQuery = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });

  const project = projectQuery.data;
  const temEspelho = Boolean(project?.mirrorPath);
  const mirrorQuery = useQuery({
    queryKey: ['mirror-state', projectId],
    queryFn: () => getMirrorState(projectId),
    // Sem destino declarado não há estado a mostrar, e a linha nem aparece —
    // buscar mesmo assim seria uma chamada por projeto para nada.
    enabled: temEspelho,
  });

  const modelosLocais = modelsQuery.data
    ? Object.values(modelsQuery.data.local).flat().length
    : null;

  return (
    <div className={sinais.bloco}>
      {/* `<p>` e não cabeçalho: a coluna lateral da Visão geral usa `<h2>`
          para as suas seções, e este bloco é subordinado ao painel, não uma
          seção irmã. */}
      <p className={sinais.titulo}>{t('ambiente.title')}</p>
      <ul className={sinais.lista}>
        <LinhaDeSinal
          rotulo={t('ambiente.codigo')}
          valor={
            project
              ? t(CHAVE_DO_MODO[project.executionMode])
              : t('ambiente.carregando')
          }
          tom={project ? 'neutro' : 'aguardando'}
          ressalva={project?.workspacePath ?? undefined}
        />

        {project?.executionMode === 'runner' && (
          <LinhaDeSinal
            rotulo={t('ambiente.runner')}
            valor={
              project.workspaceVerifiedAt
                ? t('ambiente.runnerConfirmado', {
                    data: new Date(project.workspaceVerifiedAt).toLocaleString(
                      i18n.language,
                    ),
                  })
                : t('ambiente.runnerNuncaConfirmado')
            }
            // Nem `ok` nem `erro`: uma bolinha verde aqui leria como "está de
            // pé", que é exatamente a afirmação que este dado não sustenta.
            tom={project.workspaceVerifiedAt ? 'neutro' : 'aguardando'}
            ressalva={
              project.workspaceVerifiedAt
                ? t('ambiente.runnerRessalva')
                : t('ambiente.runnerRessalvaNunca')
            }
          />
        )}

        {temEspelho && (
          <LinhaDeSinal
            rotulo={t('ambiente.espelho')}
            valor={valorDoEspelho(mirrorQuery.data, t, i18n.language)}
            // `erro` só no estado que É um erro; nunca `ok`, pela mesma razão
            // da linha do runner: verde leria como "está sincronizado agora".
            tom={
              mirrorQuery.data?.status === 'failed'
                ? 'erro'
                : mirrorQuery.data
                  ? 'neutro'
                  : 'aguardando'
            }
            ressalva={ressalvaDoEspelho(mirrorQuery.data, project?.mirrorPath, t)}
          />
        )}

        <LinhaDeSinal
          rotulo={t('ambiente.modelosLocais')}
          valor={
            modelosLocais === null
              ? t('ambiente.carregando')
              : // Zero tem frase PRÓPRIA e não sai do plural: o pt-BR põe 0 na
                // categoria `one` do CLDR, e "0 do Ollama, ativo" é uma frase
                // que ninguém escreveria de propósito.
                modelosLocais === 0
                ? t('ambiente.modelosLocaisNenhum')
                : t('ambiente.modelosLocaisValor', { count: modelosLocais })
          }
          tom={modelosLocais === null ? 'aguardando' : 'neutro'}
        />
      </ul>
    </div>
  );
}

type Traducao = ReturnType<typeof useTranslation<'overview'>>['t'];

/**
 * Uma frase por estado, e o zero tem a sua (RN-088/RN-470). O que a tela
 * NUNCA faz aqui é usar o mesmo texto para "nunca rodou" e para "rodou e não
 * copiou nada": são desfechos diferentes e o usuário age diferente em cada um.
 */
function valorDoEspelho(
  estado: MirrorState | undefined,
  t: Traducao,
  idioma: string,
): string {
  if (!estado) return t('ambiente.carregando');
  if (estado.status === 'never') return t('ambiente.espelhoNunca');

  const data = estado.lastSyncedAt
    ? new Date(estado.lastSyncedAt).toLocaleString(idioma)
    : null;

  if (estado.status === 'failed') {
    // A última cópia BOA continua na frase quando existe: é a informação mais
    // útil que a tela tem enquanto o espelho está quebrado, e foi para não
    // perdê-la que o erro nunca apaga o sucesso no banco.
    return data
      ? t('ambiente.espelhoFalhouComUltima', { data })
      : t('ambiente.espelhoFalhou');
  }

  if (estado.filesCopied === 0) return t('ambiente.espelhoSemNovidade', { data });
  return t('ambiente.espelhoValor', { count: estado.filesCopied ?? 0, data });
}

/**
 * A ressalva carrega o erro quando falhou; senão, diz o que a data significa —
 * e acrescenta o aviso de destino trocado, que é a única situação em que a
 * data é sobre outra pasta.
 */
function ressalvaDoEspelho(
  estado: MirrorState | undefined,
  destinoDeHoje: string | null | undefined,
  t: Traducao,
): string | undefined {
  if (!estado) return undefined;
  if (estado.status === 'never') return t('ambiente.espelhoRessalvaNunca');

  const trocou =
    estado.lastDestination !== null &&
    destinoDeHoje != null &&
    estado.lastDestination !== destinoDeHoje;

  const aviso = trocou
    ? ` ${t('ambiente.espelhoDestinoTrocado', { destino: estado.lastDestination })}`
    : '';

  if (estado.status === 'failed') {
    return `${t('ambiente.espelhoRessalvaErro', { erro: estado.lastError ?? '' })}${aviso}`;
  }
  return `${t('ambiente.espelhoRessalva')}${aviso}`;
}
