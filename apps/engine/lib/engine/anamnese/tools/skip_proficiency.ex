defmodule Engine.Anamnese.Tools.SkipProficiency do
  @moduledoc """
  A saída HONESTA da Anamnese: "não há nada a emitir nesta janela, e este é o
  motivo".

  Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`,
  que recusa lista vazia — então, numa janela sem membro elegível, a Anamnese
  escrevia em prosa "não há membros elegíveis", chamava `emit_proficiency` com
  `profiles: []`, era recusada, e repetia até bater no teto de iterações. Numa
  execução real isso custou **145 mil tokens de entrada e 4× o gasto do
  Criativo e do PO somados**, sem produzir nada — e voltava a cada tick do
  agendador, para sempre.

  Ela sabia a resposta na primeira iteração. Faltava como dizê-la.

  `:direct` como as demais: a Anamnese só lê o event log e escreve perfil.
  """

  @behaviour Engine.Harness.Tool

  @impl true
  def spec do
    %{
      name: "skip_proficiency",
      description:
        "Encerra a rodada SEM emitir perfil. Use quando a janela não tiver " <>
          "membro elegível, evidência suficiente ou nada de novo a registrar — " <>
          "é um desfecho legítimo, não uma falha. NÃO chame `emit_proficiency` " <>
          "com lista vazia: ela recusa, e repetir só gasta orçamento.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "motivo" => %{
            "type" => "string",
            "description" =>
              "Por que não há o que emitir, em uma frase. Vira o payload do " <>
                "evento `anamnese.run_skipped` e é o que alguém lê ao perguntar " <>
                "por que a rodada não produziu perfil."
          }
        },
        "required" => ["motivo"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  # Devolve `{:ok, …}`; quem encerra o loop é o hook de Termination, como no
  # `emit_proficiency`. A ferramenta não interrompe por conta própria — o
  # contrato de `Engine.Harness.Tool` é `{:ok, String.t()} | {:error, term()}`.
  def run(%{"motivo" => motivo}, _ctx) when is_binary(motivo) and motivo != "" do
    {:ok, "rodada encerrada sem perfis: " <> motivo}
  end

  def run(_args, _ctx),
    do: {:error, "skip_proficiency exige `motivo` (string não vazia)"}
end
