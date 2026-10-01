defmodule Engine.Agents.DevLeadTools do
  @moduledoc """
  As ferramentas do Dev Lead: propor o PLANO de execução (FASE 14d item 5,
  ADR 0053) e avaliar a IMPLEMENTABILIDADE de uma story (ADR 0090).

  Ele não escreve código — distribui trabalho e responde por ele. O plano diz
  quantos agentes por módulo e **por quê**, e — desde a RN-678 (AT-274) — de
  QUAL módulo é cada tarefa (`tarefas`, `[{taskId, modulo}]`): é por essa
  atribuição que só o `dev-<modulo>` certo pega a tarefa.

  ## Aprovar o plano ATIVA a execução (AT-263, RN-677, ADR 0194)

  Revisão da RN-161: o aceite do handoff ao Dev Lead só o traz para PLANEJAR.
  A ativação da execução (dev agents, worktrees, gasto) acontece quando o
  humano APROVA este `propose_execution_plan` — a api ganhou o executor
  (`ExecuteExecutionPlanUseCase`), que grava o módulo das tarefas e chama o
  MESMO `ActivateExecutionUseCase` do botão. A api valida o plano contra o
  `module_map` vigente já na PROPOSTA (400 `plano_de_execucao_invalido`), e a
  frase dela volta ao modelo como erro da ferramenta, para ele corrigir.

  ## O plano é `proposed_action` (ADR 0086, RN-284) — revisão da decisão original

  Até aqui o plano virava EVENTO simples no log
  (`execution.plan_proposed`), sem pipeline de aprovação: o argumento era que
  propor um plano não tem efeito externo nenhum — o gasto acontece quando os
  agentes sobem, e era lá que o teto da RN-083 cobrava autorização.
  Transformar a proposta em ação a decidir faria o usuário decidir duas vezes
  a mesma coisa.

  A auditoria de `docs/fluxo.yml` × código (achado A2) encontrou que
  `fluxo.yml` já declarava esta saída como `via: proposed_action` desde a
  ADR 0085, e o código nunca foi ajustado para bater. O dono do produto
  decidiu que o código erra: o plano é a PRIMEIRA decisão real de quanto a
  sessão vai gastar com paralelismo (RN-083 nasce aqui, não só na
  ultrapassagem de teto) — o usuário decide ativar a execução tendo VISTO o
  plano numa aprovação de verdade, não só lido uma linha no fio. A lição
  antiga ("decidir duas vezes") não desapareceu: ela é o motivo pelo qual
  `propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
  `decide.ts` — pode ser configurado para auto-aprovar, ao contrário de
  `parallelize`/`raise_max_parallel`, que nunca podem.

  `run/2` agora chama `EngineApiClient.propose_action/5` em vez de
  `append_event/3`, e o chamador (`Engine.Agents.DevLeadServer`) SUSPENDE o
  turno até a decisão — ver o moduledoc de lá para o mecanismo.

  ## `assess_implementability` (ADR 0090) — o gate `implementavel` ativo

  `docs/gates.yml` declarava o gate `implementavel` como `status: planned`
  desde a FASE 14d (dono `dev-lead`, entrada `[story-ready, plano-de-teste]`,
  entregável `parecer-implementabilidade`) — nunca ativado. Esta ferramenta
  ativa: `run_assessment/2` monta o parecer e chama
  `EngineApiClient.propose_action/5` com `"assess_implementability"`, MESMO
  padrão de `run/2`/`propose_execution_plan` acima (contrato de três
  desfechos, `{:ok, texto} | {:pending, action_id} | {:error, texto}`).

  ### O plano de teste é um PRÉ-REQUISITO, não um argumento da ferramenta

  O parecer de implementabilidade lê o `artifact.plano_de_teste` mais
  recente da story (emitido por `Engine.Gates.QaEstrategiaAgent`,
  segundo momento do `qa-lead` — ver `docs/fluxo.yml`, papel
  `qa-estrategia`) do HISTÓRICO da própria sessão do Dev Lead. Duas
  chamadas possíveis:

    1. **Sem plano ainda** — `run_assessment/2` DISPARA a avaliação por
       `Engine.Gates.Dispatcher.run_qa_estrategia/3` (mesma indireção
       trocável em teste que `run_qa/2`/`run_secops/2` já usam — sobe o
       `QaLeadServer` do projeto se preciso e chama `run_design/3`, `cast`
       assíncrono, mesmo estilo do resto da área de QA) e devolve
       `{:error, texto}`
       explicando que ainda não há plano e que o modelo deve chamar de
       novo em instantes. Erro de ferramenta é ENTRADA do laço, não fim de
       linha (RN-163): o Dev Lead tem teto de 14 iterações para tentar de
       novo depois que o plano existir. A janela de espera é aceita e
       declarada — o `QaEstrategiaAgent` roda em processo separado
       (`qa-lead`), então não há como este `run/2` síncrono bloquear
       esperando o resultado sem acoplar os dois processos.
    2. **Com plano** — monta o parecer (`storyId`/`parecer`/
       `justificativa`/o plano de teste embutido no payload, para o
       usuário decidir sem precisar abrir dois eventos) e propõe a ação.

  ### O appsec dispara junto, e NÃO é pré-requisito (RN-539)

  `Engine.Gates.SecOpsAgentServer.run_design/2` — o threat model STRIDE-lite
  de DESIGN (appsec, RN-360, mesmo ADR 0090) — nasceu ACIONÁVEL e sem
  chamador de produção nenhum: `docs/fluxo.yml` declarava a lacuna e já
  nomeava ESTE ponto como o gatilho natural. É ele agora, por
  `Engine.Gates.Dispatcher.run_appsec_design/2`.

  Ele dispara em PARALELO, nas DUAS saídas acima, e o parecer NÃO espera por
  ele. Fazer o parecer depender do threat model faria o gate `implementavel`
  depender de DUAS produções assíncronas em vez de uma, e queimaria dois
  turnos do Dev Lead onde hoje se queima um. O threat model chega a quem
  precisa pelo caminho que a RN-361 já definiu — handoff para `arquiteto`,
  `dev-lead` e `infra` —, não por este retorno.

  A idempotência é obrigatória, e é o que `disparar_appsec_se_preciso/3`
  guarda: o desfecho `:sem_plano` PEDE ao modelo que chame de novo, e sem a
  guarda cada rechamada custaria mais uma rodada de LLM e mais três handoffs
  sobre a mesma story.
  """

  alias Engine.Agents.Reidratacao
  alias Engine.Gates.Dispatcher
  alias Engine.Sessions.EngineApiClient

  @spec spec() :: map()
  def spec do
    %{
      name: "propose_execution_plan",
      description:
        "Propõe o plano de execução: quantos agentes por módulo e por quê. " <>
          "Use UMA vez, depois de avaliar o module_map e o backlog pegável, e " <>
          "atribua cada tarefa a um módulo em `tarefas`. É uma decisão real, que " <>
          "o usuário aprova ou recusa em Aprovações — APROVAR é o que ativa a " <>
          "execução (sobe os dev agents), e a conversa espera a decisão antes " <>
          "de continuar.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "modulos" => %{
            "type" => "array",
            "description" => "um item por módulo que você quer trabalhar agora",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "modulo" => %{"type" => "string"},
                "agentes" => %{
                  "type" => "integer",
                  "minimum" => 1,
                  "description" => "quantos agentes neste módulo"
                },
                "porque" => %{
                  "type" => "string",
                  "description" => "o que no backlog justifica esse número"
                }
              },
              "required" => ["modulo", "agentes", "porque"]
            }
          },
          "resumo" => %{
            "type" => "string",
            "description" => "o plano em uma frase, para o usuário decidir sem ler a lista"
          },
          "tarefas" => %{
            "type" => "array",
            "description" =>
              "TODA tarefa pendente do backlog, cada uma com o módulo (do module_map) " <>
                "cujo dev agent vai pegá-la — só o dev daquele módulo pega a tarefa",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "taskId" => %{
                  "type" => "string",
                  "description" => "o task_id da lista de tarefas"
                },
                "modulo" => %{"type" => "string", "description" => "um módulo do module_map"}
              },
              "required" => ["taskId", "modulo"]
            }
          }
        },
        "required" => ["modulos", "resumo", "tarefas"]
      }
    }
  end

  @spec run(map(), map()) :: {:ok, String.t()} | {:pending, String.t()} | {:error, String.t()}
  def run(%{"modulos" => modulos, "resumo" => resumo} = args, state) when is_list(modulos) do
    case validar(modulos) do
      {:error, motivo} ->
        {:error, motivo}

      {:ok, normalizados} ->
        total = Enum.reduce(normalizados, 0, &(&1.agentes + &2))
        actor = %{kind: "agent", id: "dev-lead"}

        # `tarefas` vai como veio: quem a confere é a API, contra o
        # `module_map` vigente (RN-678) — uma régua só, e a frase da recusa
        # dela volta ao modelo (`erro_da_proposta/1`).
        tarefas = Map.get(args, "tarefas", [])

        payload = %{
          modulos: normalizados,
          resumo: resumo,
          totalAgentes: total,
          tarefas: tarefas
        }

        case EngineApiClient.propose_action(
               state.project_id,
               state.session_id,
               "propose_execution_plan",
               actor,
               payload
             ) do
          {:ok, action} ->
            classificar(Map.get(action, "status"), action, total, normalizados)

          {:error, reason} ->
            {:error, erro_da_proposta(reason)}
        end
    end
  end

  def run(_args, _state),
    do: {:error, "propose_execution_plan exige `modulos` (lista) e `resumo`"}

  # A recusa NOMEADA da api (RN-678): tarefa sem módulo, módulo fora do
  # `module_map`, tarefa que não é do projeto. A frase vai ao modelo como está,
  # com o que fazer — é entrada do laço (RN-163), e ele corrige o plano.
  defp erro_da_proposta({400, %{"code" => "plano_de_execucao_invalido", "message" => motivo}}),
    do: "plano recusado: #{motivo} Corrija `tarefas` e proponha o plano de novo."

  defp erro_da_proposta(reason),
    do: "não consegui propor o plano de execução: #{inspect(reason)}"

  # Desde a RN-677 (AT-263, ADR 0194) `propose_execution_plan` TEM pipeline
  # na api: aprovar (ou auto-aprovar) grava o módulo das tarefas e ATIVA a
  # execução, e a ação termina `executed` (com a sessão de execução no
  # `executionResult`) ou `failed` (com o motivo). Auto-aprovado, a api já
  # executa na proposta e devolve o desfecho aqui; `"auto_approved"`/
  # `"approved"` seguem contando como sucesso para não chamar de erro uma ação
  # cujo desfecho ainda não chegou.
  defp classificar("executed", _action, total, normalizados) do
    {:ok,
     "plano aprovado e execução ATIVADA: #{total} agente(s) em " <>
       "#{length(normalizados)} módulo(s); cada tarefa vai para o dev do módulo atribuído."}
  end

  defp classificar(status, _action, total, normalizados)
       when status in ["auto_approved", "approved"] do
    {:ok,
     "plano aprovado: #{total} agente(s) em #{length(normalizados)} módulo(s). " <>
       "A aprovação ativa a execução."}
  end

  defp classificar("failed", action, _total, _normalizados) do
    motivo = get_in(action, ["executionResult", "motivo"]) || "sem motivo registrado"

    {:error,
     "o plano foi aprovado, mas a ativação da execução falhou: #{motivo}. " <>
       "Diga ao usuário o que falta."}
  end

  defp classificar("pending", %{"id" => action_id}, _total, _normalizados)
       when is_binary(action_id) do
    {:pending, action_id}
  end

  defp classificar(status, _action, _total, _normalizados) do
    {:error, "o plano não foi registrado (status inesperado: #{inspect(status)})"}
  end

  # Plano vazio, ou com zero agente num módulo, não é plano — e chegaria ao
  # usuário como uma decisão sem conteúdo.
  defp validar([]), do: {:error, "o plano precisa de ao menos um módulo"}

  defp validar(modulos) do
    Enum.reduce_while(modulos, {:ok, []}, fn item, {:ok, acc} ->
      modulo = Map.get(item, "modulo")
      agentes = Map.get(item, "agentes")
      porque = Map.get(item, "porque", "")

      cond do
        not is_binary(modulo) or modulo == "" ->
          {:halt, {:error, "cada item precisa de `modulo` não vazio"}}

        not is_integer(agentes) or agentes < 1 ->
          {:halt,
           {:error,
            "módulo #{modulo}: `agentes` precisa ser inteiro >= 1 (recebido: #{inspect(agentes)})"}}

        true ->
          {:cont, {:ok, acc ++ [%{modulo: modulo, agentes: agentes, porque: porque}]}}
      end
    end)
  end

  # --- assess_implementability (ADR 0090) --------------------------------

  @spec spec_assess_implementability() :: map()
  def spec_assess_implementability do
    %{
      name: "assess_implementability",
      description:
        "Avalia se uma story do backlog é IMPLEMENTÁVEL, a partir do plano de " <>
          "teste da QA-estratégia (docs/fluxo.yml). Se a story ainda não tem " <>
          "plano de teste, esta chamada DISPARA a avaliação e devolve erro " <>
          "pedindo para tentar de novo em instantes — não propõe decisão " <>
          "nenhuma nesse caso. Com o plano em mãos, propõe o parecer de " <>
          "implementabilidade: é uma decisão real, que o usuário aprova ou " <>
          "recusa em Aprovações (gate `implementavel`). Nos dois casos, se a " <>
          "story ainda não tem threat model, esta chamada também pede o de " <>
          "AppSec — que corre em paralelo e não atrasa o parecer.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "storyId" => %{"type" => "string"},
          "parecer" => %{
            "type" => "string",
            "enum" => ["implementavel", "inviavel"]
          },
          "justificativa" => %{
            "type" => "string",
            "description" => "o que no plano de teste (ou na story) sustenta o parecer"
          }
        },
        "required" => ["storyId", "parecer", "justificativa"]
      }
    }
  end

  @spec run_assessment(map(), map()) ::
          {:ok, String.t()} | {:pending, String.t()} | {:error, String.t()}
  def run_assessment(
        %{"storyId" => story_id, "parecer" => parecer, "justificativa" => justificativa},
        state
      )
      when parecer in ["implementavel", "inviavel"] do
    # A CAUDA, com o mesmo teto da reidratação (RN-580, ADR 0060): sem
    # `latest`, a api devolve os PRIMEIROS 200 e numa sessão longa o plano de
    # teste recém-emitido ficava de fora.
    case EngineApiClient.list_events(state.project_id, state.session_id,
           latest: true,
           limit: Reidratacao.teto()
         ) do
      {:ok, eventos} ->
        # Em PARALELO, e sem que o parecer dependa disso — ver a seção
        # "O appsec dispara junto" no moduledoc.
        disparar_appsec_se_preciso(state, story_id, eventos)

        case plano_de_teste_mais_recente(eventos, story_id) do
          {:ok, plano} ->
            propor_parecer(state, story_id, parecer, justificativa, plano)

          :sem_plano ->
            Dispatcher.run_qa_estrategia(state.project_id, state.session_id, story_id)

            {:error,
             "ainda não há plano de teste para essa story — pedi a avaliação de " <>
               "QA-estratégia agora. Chame assess_implementability de novo em " <>
               "instantes (o parecer só sai depois que o plano existir)."}
        end

      {:error, reason} ->
        {:error, "não consegui ler o histórico da sessão: #{inspect(reason)}"}
    end
  end

  def run_assessment(_args, _state),
    do:
      {:error,
       "assess_implementability exige storyId, parecer (implementavel|inviavel) e justificativa"}

  # O plano de teste vive no event log da PRÓPRIA sessão do Dev Lead — é lá
  # que `Engine.Gates.QaEstrategiaAgent.run/4` emite `artifact.plano_de_teste`
  # (ver `qa_estrategia_agent.ex`, chamado com o mesmo `session_id`). O MAIS
  # RECENTE vence: o histórico é imutável, uma story pode ser reavaliada.
  #
  # A leitura do histórico é UMA por chamada de `run_assessment/2` (o
  # chamador acima), e as duas perguntas — "já há plano de teste?" e "já há
  # threat model?" — são respondidas sobre a MESMA lista. Duas chamadas de
  # `list_events/2` na mesma invocação seriam o amplificador de tráfego que
  # o ADR 0060 recusa, ainda mais aqui: o modelo é instruído a tentar de
  # novo, então este caminho é quente.
  defp plano_de_teste_mais_recente(eventos, story_id) do
    eventos
    |> Enum.filter(&plano_da_story?(&1, story_id))
    |> List.last()
    |> case do
      nil -> :sem_plano
      evento -> {:ok, Map.get(evento, "payload", %{})}
    end
  end

  defp plano_da_story?(%{"type" => "artifact.plano_de_teste", "payload" => payload}, story_id),
    do: Map.get(payload, "storyId") == story_id

  defp plano_da_story?(_evento, _story_id), do: false

  # RN-539: o appsec (`Engine.Gates.SecOpsAgentServer.run_design/2`) era
  # ACIONÁVEL e não tinha chamador de produção nenhum — `docs/fluxo.yml`
  # declarava a lacuna e nomeava ESTE ponto como o gatilho natural.
  #
  # A guarda de idempotência não é zelo: o desfecho `:sem_plano` acima PEDE
  # ao modelo que chame `assess_implementability` de novo, e sem ela cada
  # rechamada dispararia outra rodada de LLM do appsec e mais três handoffs
  # (RN-361) sobre a MESMA story. A pergunta aqui é EXISTE, não QUAL —
  # diferente do plano de teste, onde o mais recente vence.
  #
  # Limite declarado: `artifact.threat_model` é emitido na sessão da STORY
  # (`emit_threat_model/3` lê `story["sessionId"]`), enquanto esta leitura é
  # da sessão do DEV LEAD. No caminho comum são a mesma sessão — o Dev Lead
  # avalia stories do backlog que a própria sessão de execução criou. Não
  # sendo, a guarda não enxerga o threat model e o appsec roda de novo:
  # custo de uma rodada de LLM repetida, nunca dado errado (o artefato é
  # append-only, e quem consome é o handoff). Fechar isso exigiria a api
  # aceitar uma busca de artefato por story ATRAVÉS de sessões, que hoje não
  # existe — fora do escopo desta entrega.
  defp disparar_appsec_se_preciso(state, story_id, eventos) do
    unless Enum.any?(eventos, &threat_model_da_story?(&1, story_id)) do
      Dispatcher.run_appsec_design(state.project_id, story_id)
    end

    :ok
  end

  defp threat_model_da_story?(
         %{"type" => "artifact.threat_model", "payload" => payload},
         story_id
       ),
       do: Map.get(payload, "storyId") == story_id

  defp threat_model_da_story?(_evento, _story_id), do: false

  defp propor_parecer(state, story_id, parecer, justificativa, plano) do
    actor = %{kind: "agent", id: "dev-lead"}

    payload = %{
      storyId: story_id,
      parecer: parecer,
      justificativa: justificativa,
      planoDeTeste: Map.get(plano, "planoDeTeste"),
      criteriosExecutaveis: Map.get(plano, "criteriosExecutaveis", [])
    }

    case EngineApiClient.propose_action(
           state.project_id,
           state.session_id,
           "assess_implementability",
           actor,
           payload
         ) do
      {:ok, action} ->
        classificar_parecer(Map.get(action, "status"), Map.get(action, "id"), parecer, story_id)

      {:error, reason} ->
        {:error, "não consegui propor o parecer de implementabilidade: #{inspect(reason)}"}
    end
  end

  # Mesmo raciocínio de `classificar/4`, acima: `assess_implementability`
  # também não tem execute-* pipeline própria (não há efeito a aplicar —
  # o parecer é registro para o usuário decidir). Os três contam sucesso.
  defp classificar_parecer(status, _action_id, parecer, story_id)
       when status in ["executed", "auto_approved", "approved"] do
    {:ok,
     "parecer (#{parecer}) registrado para a story #{story_id}. " <>
       "O usuário decide em Aprovações."}
  end

  defp classificar_parecer("pending", action_id, _parecer, _story_id)
       when is_binary(action_id) do
    {:pending, action_id}
  end

  defp classificar_parecer(status, _action_id, _parecer, _story_id) do
    {:error, "o parecer não foi registrado (status inesperado: #{inspect(status)})"}
  end
end
