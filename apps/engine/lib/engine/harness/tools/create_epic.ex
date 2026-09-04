defmodule Engine.Harness.Tools.CreateEpic do
  @moduledoc """
  Ferramenta do PO: cria um épico via a api (nunca SQL direto). `:direct` —
  não entra no `@registry` global (só o PoServer a advertise). Retorna o id no
  texto do resultado pro modelo encadear as stories.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_epic",
      description: "Cria um épico do backlog. Retorna o id para usar como epic_id nas histórias.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"}
        },
        "required" => ["title"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"title" => title} = args, ctx) do
    fields = %{title: title, description: Map.get(args, "description", "")}

    case EngineApiClient.create_epic(ctx.project_id, ctx.session_id, fields) do
      {:ok, %{"id" => id}} ->
        {:ok, "épico criado: id=#{id} — use este id como epic_id nas histórias."}

      {:error, reason} ->
        {:error, "falha ao criar épico: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_epic exige `title`"}

  @doc """
  O id do épico dentro do texto que `run/2` devolveu, ou `nil`.

  O contrato de `Engine.Harness.Tool` só permite devolver STRING, e o id já
  viaja nela porque o modelo precisa dele para encadear as histórias. Quem
  também precisa dele é o PoServer, para cobrar o épico que ficou sem história
  (RN-165) — e é melhor ler o formato aqui, no módulo que o escreve, do que
  repetir a expressão do outro lado e deixá-la divergir na primeira mudança de
  frase.
  """
  @spec id_no_resultado(String.t()) :: String.t() | nil
  def id_no_resultado(texto) when is_binary(texto) do
    case Regex.run(~r/\bid=([^\s,]+)/, texto) do
      [_, id] -> id
      _ -> nil
    end
  end

  def id_no_resultado(_), do: nil
end
