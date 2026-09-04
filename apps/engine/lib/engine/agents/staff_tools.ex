defmodule Engine.Agents.StaffTools do
  @moduledoc """
  A ferramenta do Staff (papel `staff`, `docs/fluxo.yml`
  `camada_decisao_tecnica`, ADR 0088): propor um RFC — o problema sistêmico,
  as opções consideradas (com trade-offs), a recomendação e o escopo de uma
  PoC DESCARTÁVEL — e devolvê-lo ao Arquiteto, que decide o que entra na
  arquitetura.

  ## Por que `propose_rfc` não é `proposed_action`

  Mesmo raciocínio do `emit_insight` do Arquiteto
  (`Engine.Harness.Tools.EmitInsight`): registrar um documento de arquitetura
  não é efeito externo (não é git, terminal, nem gasto de agente) — não há o
  que o usuário precise aprovar ANTES de o RFC existir. A decisão real
  (adotar, adaptar ou recusar a recomendação) é do Arquiteto, no handoff que
  este tool já devolve.

  ## Por que o evento é gravado DIRETO, sem caso de uso dedicado na api

  `artifact.c4_diagram` (ADR 0068) tem caso de uso próprio na api porque o
  nível Container é DERIVADO do `module_map` vigente — só a api tem esse
  dado. O RFC não deriva nada do lado de lá: `problema`/`opcoes`/
  `recomendacao`/`poc` vêm inteiros do tool call, então `run/2` grava
  `artifact.rfc_staff` via `EngineApiClient.append_event_returning/3`, o
  MESMO padrão sem tabela e sem caso de uso do `EmitInsight` (e do
  `product_brief` do Criativo) — não o do C4 diagram.

  ## Por que o handoff de volta acontece NO MESMO `run/2`

  O RFC só existe para alimentar o Arquiteto — ao contrário de
  `ArquitetoServer.offer_infra_handoff/1` (que é um passo SEPARADO,
  confirmado pelo usuário), aqui não há confirmação humana no meio: gravar o
  artefato e oferecer o handoff são o MESMO ato, mesmo padrão de
  `CriativoServer.executar_confirm_readiness/1` emitindo o product_brief e
  oferecendo o handoff ao PO na mesma resposta.
  """

  alias Engine.Sessions.EngineApiClient

  @spec spec() :: map()
  def spec do
    %{
      name: "propose_rfc",
      description:
        "Propõe um RFC: o problema sistêmico, as opções consideradas (com trade-offs), " <>
          "a recomendação e o escopo de uma PoC DESCARTÁVEL para validar a recomendação " <>
          "antes de comprometer a arquitetura. Ao gravar, o RFC é devolvido ao Arquiteto " <>
          "por handoff — é ele quem decide o que entra na arquitetura. Use UMA vez.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "problema" => %{
            "type" => "string",
            "description" => "o problema sistêmico que motiva o RFC"
          },
          "opcoes" => %{
            "type" => "array",
            "description" => "as alternativas consideradas, cada uma com seu trade-off",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "descricao" => %{"type" => "string"},
                "tradeoffs" => %{"type" => "string"}
              },
              "required" => ["descricao", "tradeoffs"]
            }
          },
          "recomendacao" => %{
            "type" => "string",
            "description" => "qual opção você recomenda, e por quê"
          },
          "poc" => %{
            "type" => "object",
            "description" =>
              "escopo de uma prova de conceito DESCARTÁVEL, para validar a recomendação " <>
                "antes de comprometer a arquitetura de verdade",
            "properties" => %{
              "escopo" => %{"type" => "string"}
            },
            "required" => ["escopo"]
          }
        },
        "required" => ["problema", "opcoes", "recomendacao", "poc"]
      }
    }
  end

  @spec run(map(), map()) :: {:ok, String.t()} | {:error, String.t()}
  def run(
        %{
          "problema" => problema,
          "opcoes" => opcoes,
          "recomendacao" => recomendacao,
          "poc" => poc
        },
        state
      )
      when is_binary(problema) and is_list(opcoes) and is_binary(recomendacao) and is_map(poc) do
    case validar(problema, opcoes, recomendacao, poc) do
      {:error, motivo} ->
        {:error, motivo}

      {:ok, payload} ->
        event = %{
          type: "artifact.rfc_staff",
          actorKind: "agent",
          actorId: "staff",
          payload: payload
        }

        case EngineApiClient.append_event_returning(state.project_id, state.session_id, event) do
          {:ok, %{"id" => artifact_id}} ->
            devolver_ao_arquiteto(state, artifact_id)

          {:error, reason} ->
            {:error, "falha ao registrar o RFC: #{inspect(reason)}"}
        end
    end
  end

  def run(_args, _state),
    do: {:error, "propose_rfc exige `problema`, `opcoes` (lista), `recomendacao` e `poc`"}

  # Era `{:ok, _handoff} = ...`: um `MatchError` no `{:error, _}` derrubaria o
  # GenServer inteiro DEPOIS do RFC já gravado (RN-116, mesmo achado do
  # Criativo → PO e do Arquiteto → Infra/Dev Lead). O RFC não se perde: só o
  # handoff falha, e o modelo sabe pelo tool-result que precisa tentar de
  # novo.
  defp devolver_ao_arquiteto(state, artifact_id) do
    case EngineApiClient.create_handoff(
           state.project_id,
           state.session_id,
           "staff",
           "arquiteto",
           artifact_id
         ) do
      {:ok, _handoff} ->
        {:ok, "RFC registrado e devolvido ao Arquiteto para decisão."}

      {:error, reason} ->
        {:error,
         "RFC registrado, mas falhei ao devolver o handoff ao Arquiteto: #{inspect(reason)}. " <>
           "Tente de novo — o RFC já está salvo, não precisa reescrevê-lo."}
    end
  end

  defp validar(problema, opcoes, recomendacao, poc) do
    with :ok <- not_blank("problema", problema),
         :ok <- not_blank("recomendacao", recomendacao),
         {:ok, opcoes_norm} <- validar_opcoes(opcoes),
         {:ok, poc_norm} <- validar_poc(poc) do
      {:ok,
       %{
         problema: problema,
         opcoes: opcoes_norm,
         recomendacao: recomendacao,
         poc: poc_norm
       }}
    end
  end

  defp not_blank(_campo, valor) when is_binary(valor) and valor != "", do: :ok
  defp not_blank(campo, _valor), do: {:error, "`#{campo}` não pode ser vazio"}

  defp validar_opcoes([]), do: {:error, "informe ao menos uma opção em `opcoes`"}

  defp validar_opcoes(opcoes) do
    Enum.reduce_while(opcoes, {:ok, []}, fn item, {:ok, acc} ->
      descricao = Map.get(item, "descricao")
      tradeoffs = Map.get(item, "tradeoffs")

      cond do
        not is_binary(descricao) or descricao == "" ->
          {:halt, {:error, "cada opção precisa de `descricao` não vazia"}}

        not is_binary(tradeoffs) or tradeoffs == "" ->
          {:halt, {:error, "opção \"#{descricao}\": `tradeoffs` não pode ser vazio"}}

        true ->
          {:cont, {:ok, acc ++ [%{descricao: descricao, tradeoffs: tradeoffs}]}}
      end
    end)
  end

  # `descartavel` é FIXO em `true` — não vem do modelo. A PoC do Staff é
  # descartável por definição (docs/fluxo.yml: `poc-descartavel`); deixar o
  # modelo escrever esse campo abriria a possibilidade de ele declarar uma
  # PoC "não descartável", que não é o que esta ferramenta existe para
  # produzir.
  defp validar_poc(%{"escopo" => escopo}) when is_binary(escopo) and escopo != "" do
    {:ok, %{escopo: escopo, descartavel: true}}
  end

  defp validar_poc(_poc), do: {:error, "`poc.escopo` não pode ser vazio"}
end
