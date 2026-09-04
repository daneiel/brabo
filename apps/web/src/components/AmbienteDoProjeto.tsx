import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProject, listModels } from '../lib/api-client';
import type { ExecutionMode } from '../lib/api-types';
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
 * ## Nenhuma requisição a mais
 *
 * As duas consultas reusam as chaves que a página já usa: `['project', id]`
 * é a mesma de `ProjectPage` e `['models', id]` a mesma da própria Visão
 * geral. O TanStack devolve do cache.
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
