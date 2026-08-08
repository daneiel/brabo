defmodule Engine.Agents.DevLeadTools do
  @moduledoc """
  A ferramenta do Dev Lead (FASE 14d item 5, ADR 0053): propor o PLANO de
  execução.

  Ele não escreve código — distribui trabalho e responde por ele. O plano diz
  quantos agentes por módulo e **por quê**, e é isso que o usuário aceita ao
  ativar a execução.

  O plano vira EVENTO no log, não `proposed_action`. A distinção não é
  cosmética: propor um plano não tem efeito externo nenhum — o gasto acontece
  quando os agentes sobem, e é lá que o teto da [RN-083] cobra autorização.
  Transformar a proposta em ação a decidir faria o usuário decidir duas vezes a
  mesma coisa.
  """

  alias Engine.Sessions.EngineApiClient

  @spec spec() :: map()
  def spec do
    %{
      name: "propose_execution_plan",
      description:
        "Registra o plano de execução: quantos agentes por módulo e por quê. " <>
          "Use UMA vez, depois de avaliar o module_map e o backlog pegável. " <>
          "Não sobe agente nenhum — quem sobe é o usuário ao ativar a execução, " <>
          "e passar do teto da área exige autorização dele.",
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

  @spec run(map(), map()) :: {:ok, String.t()} | {:error, String.t()}
  def run(%{"modulos" => modulos, "resumo" => resumo}, state) when is_list(modulos) do
    case validar(modulos) do
      {:error, motivo} ->
        {:error, motivo}

      {:ok, normalizados} ->
        total = Enum.reduce(normalizados, 0, &(&1.agentes + &2))

        EngineApiClient.append_event(state.project_id, state.session_id, %{
          type: "execution.plan_proposed",
          actorKind: "agent",
          actorId: "dev-lead",
          payload: %{modulos: normalizados, resumo: resumo, totalAgentes: total}
        })

        {:ok,
         "plano registrado: #{total} agente(s) em #{length(normalizados)} módulo(s). " <>
           "O usuário decide ao ativar a execução."}
    end
  end

  def run(_args, _state),
    do: {:error, "propose_execution_plan exige `modulos` (lista) e `resumo`"}

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
end
