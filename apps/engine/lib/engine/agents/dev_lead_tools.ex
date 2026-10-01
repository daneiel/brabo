defmodule Engine.Agents.DevLeadTools do
  @moduledoc """
  As ferramentas do Dev Lead: propor o PLANO de execução (FASE 14d item 5,
  ADR 0053) e avaliar a IMPLEMENTABILIDADE de uma story (ADR 0090).

  Ele não escreve código — distribui trabalho e responde por ele. O plano diz
  quantos agentes por módulo e **por quê**, e é isso que o usuário aceita ao
  ativar a execução.

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
  desde a FASE 14d (dono `dev-lead`, entregável `parecer-implementabilidade`)
  — nunca ativado. Esta ferramenta ativa: `run_assessment/2` monta o parecer
  e chama `EngineApiClient.propose_action/5` com `"assess_implementability"`,
  MESMO padrão de `run/2`/`propose_execution_plan` acima (contrato de três
  desfechos, `{:ok, texto} | {:pending, action_id} | {:error, texto}`).

  ### O insumo é a story e o `module_map`, não o plano de teste (ADR 0192)

  O ADR 0090 fazia o parecer depender do `artifact.plano_de_teste` da story:
  sem plano, esta ferramenta disparava a QA-estratégia e devolvia erro
  pedindo para chamar de novo. No uso real de 29/09 o plano NUNCA chegou —
  a QA-estratégia esgotou o teto de 8 iterações procurando um código que
  ainda não existia — e o Dev Lead ficou sem parecer. O dono decidiu (01/10)
  que o plano de teste nasce DEPOIS da entrega do dev (RN-674), e o gate
  perdeu aquele insumo. O que o substitui é o que o Dev Lead JÁ tem no
  contexto do próprio turno: a história (RF, RNF, DoD) e o `module_map`
  vigente, que o kickoff dele lista. O julgamento é dele, na `justificativa`
  — a ferramenta não busca nada para isso, e o parecer sai na PRIMEIRA
  chamada. O payload perdeu `planoDeTeste`/`criteriosExecutaveis`: não há
  plano para embutir antes do código.

  ### O appsec dispara junto, e NÃO é pré-requisito (RN-539)

  `Engine.Gates.SecOpsAgentServer.run_design/2` — o threat model STRIDE-lite
  de DESIGN (appsec, RN-360, mesmo ADR 0090) — nasceu ACIONÁVEL e sem
  chamador de produção nenhum: `docs/fluxo.yml` declarava a lacuna e já
  nomeava ESTE ponto como o gatilho natural. É ele agora, por
  `Engine.Gates.Dispatcher.run_appsec_design/2`.

  Ele dispara em PARALELO à proposta do parecer, e o parecer NÃO espera por
  ele. Fazer o parecer depender do threat model faria o gate `implementavel`
  depender de uma produção assíncrona — exatamente a espera que o ADR 0192
  tirou do plano de teste. O threat model chega a quem
  precisa pelo caminho que a RN-361 já definiu — handoff para `arquiteto`,
  `dev-lead` e `infra` —, não por este retorno.

  A idempotência é obrigatória, e é o que `disparar_appsec_se_preciso/3`
  guarda: o modelo pode reavaliar a mesma story (ou repetir a chamada depois
  de um erro), e sem a guarda cada rechamada custaria mais uma rodada de LLM
  e mais três handoffs sobre a mesma story.
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
          "Use UMA vez, depois de avaliar o module_map e o backlog pegável. " <>
          "É uma decisão real, que o usuário aprova ou recusa em Aprovações — " <>
          "não sobe agente nenhum sozinho, e a conversa espera a decisão " <>
          "antes de continuar.",
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
          }
        },
        "required" => ["modulos", "resumo"]
      }
    }
  end

  @spec run(map(), map()) :: {:ok, String.t()} | {:pending, String.t()} | {:error, String.t()}
  def run(%{"modulos" => modulos, "resumo" => resumo}, state) when is_list(modulos) do
    case validar(modulos) do
      {:error, motivo} ->
        {:error, motivo}

      {:ok, normalizados} ->
        total = Enum.reduce(normalizados, 0, &(&1.agentes + &2))
        actor = %{kind: "agent", id: "dev-lead"}

        payload = %{modulos: normalizados, resumo: resumo, totalAgentes: total}

        case EngineApiClient.propose_action(
               state.project_id,
               state.session_id,
               "propose_execution_plan",
               actor,
               payload
             ) do
          {:ok, action} ->
            classificar(Map.get(action, "status"), Map.get(action, "id"), total, normalizados)

          {:error, reason} ->
            {:error, "não consegui propor o plano de execução: #{inspect(reason)}"}
        end
    end
  end

  def run(_args, _state),
    do: {:error, "propose_execution_plan exige `modulos` (lista) e `resumo`"}

  # `propose_execution_plan` não tem execute-* pipeline (não há efeito a
  # aplicar na aprovação — a criação dos agentes acontece depois, num ato
  # SEPARADO, quando o usuário ativa a execução). Por isso a aprovação
  # manual nunca sai de `"approved"` — a máquina de estados
  # (`action-state-machine.ts`) modela `approved -> executed | failed` como
  # aberto, mas nada aqui chama essa transição, e não deveria: não há o que
  # executar. `"auto_approved"` é o caminho da aprovação automática (o
  # usuário configurou `permissions.json`/`agent_autonomy`); `"executed"`
  # entraria aqui se um dia este tipo ganhar pipeline própria. Os três
  # contam como sucesso — o plano foi aceito.
  defp classificar(status, _action_id, total, normalizados)
       when status in ["executed", "auto_approved", "approved"] do
    {:ok,
     "plano aprovado: #{total} agente(s) em #{length(normalizados)} módulo(s). " <>
       "O usuário ativa a execução quando quiser."}
  end

  defp classificar("pending", action_id, _total, _normalizados) when is_binary(action_id) do
    {:pending, action_id}
  end

  defp classificar(status, _action_id, _total, _normalizados) do
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
        "Avalia se uma story do backlog é IMPLEMENTÁVEL, a partir da própria " <>
          "história (RF, RNF, definition of done) e do module_map vigente que " <>
          "você já tem no contexto — o plano de teste só existe DEPOIS da " <>
          "entrega do dev, não é insumo daqui. Propõe o parecer de " <>
          "implementabilidade: é uma decisão real, que o usuário aprova ou " <>
          "recusa em Aprovações (gate `implementavel`). Se a story ainda não " <>
          "tem threat model, esta chamada também pede o de AppSec — que corre " <>
          "em paralelo e não atrasa o parecer.",
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
            "description" => "o que na story (RF/RNF/DoD) e no module_map sustenta o parecer"
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
    # `latest`, a api devolve os PRIMEIROS 200 e numa sessão longa o threat
    # model recém-emitido ficava de fora.
    case EngineApiClient.list_events(state.project_id, state.session_id,
           latest: true,
           limit: Reidratacao.teto()
         ) do
      {:ok, eventos} ->
        # Em PARALELO, e sem que o parecer dependa disso — ver a seção
        # "O appsec dispara junto" no moduledoc. É a ÚNICA razão de ler o
        # histórico aqui desde o ADR 0192: o plano de teste deixou de ser
        # pré-requisito.
        disparar_appsec_se_preciso(state, story_id, eventos)
        propor_parecer(state, story_id, parecer, justificativa)

      {:error, reason} ->
        {:error, "não consegui ler o histórico da sessão: #{inspect(reason)}"}
    end
  end

  def run_assessment(_args, _state),
    do:
      {:error,
       "assess_implementability exige storyId, parecer (implementavel|inviavel) e justificativa"}

  # A leitura do histórico é UMA por chamada de `run_assessment/2` (ADR 0060:
  # nada de duas leituras na mesma invocação), e serve só à guarda do appsec.
  #
  # RN-539: o appsec (`Engine.Gates.SecOpsAgentServer.run_design/2`) era
  # ACIONÁVEL e não tinha chamador de produção nenhum — `docs/fluxo.yml`
  # declarava a lacuna e nomeava ESTE ponto como o gatilho natural.
  #
  # A guarda de idempotência não é zelo: o modelo pode chamar
  # `assess_implementability` de novo para a mesma story (reavaliar, ou
  # repetir depois de um erro), e sem ela cada rechamada dispararia outra
  # rodada de LLM do appsec e mais três handoffs (RN-361) sobre a MESMA
  # story. A pergunta aqui é EXISTE, não QUAL.
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

  # ADR 0192: sem `planoDeTeste`/`criteriosExecutaveis` — o plano nasce
  # depois da entrega e não existe aqui. O que o usuário lê para decidir é a
  # justificativa do Dev Lead sobre a história e o `module_map`.
  defp propor_parecer(state, story_id, parecer, justificativa) do
    actor = %{kind: "agent", id: "dev-lead"}

    payload = %{
      storyId: story_id,
      parecer: parecer,
      justificativa: justificativa
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
