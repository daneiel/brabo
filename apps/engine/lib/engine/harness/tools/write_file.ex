defmodule Engine.Harness.Tools.WriteFile do
  @moduledoc """
  Escreve um arquivo no workspace. Dentro da whitelist do agente
  (`WriteFilePolicy`) escreve DIRETO — é isso que `run/2` faz. Fora da
  whitelist, o hook `:pre_tool_use` (ActionPipeline) intercepta ANTES e cria
  um `proposed_action` (aprovação humana), então `run/2` nem é chamado.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  # RN-900 (AT-571): título da seção de uso do README que a Infra escreve. Usado
  # também nos prompts da Infra e do dev, para que o nome não divirja.
  @titulo_secao_de_uso "Rodar na sua máquina"
  def titulo_secao_de_uso, do: @titulo_secao_de_uso

  @impl true
  def spec do
    %{
      name: "write_file",
      description:
        "Escreve conteúdo num arquivo do workspace. SUBSTITUI o arquivo inteiro: para mudar um trecho, leia e reescreva o arquivo completo. Fora da whitelist do agente, vira uma ação proposta pra aprovação.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "path" => %{"type" => "string"},
          "content" => %{"type" => "string"}
        },
        "required" => ["path", "content"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"path" => path, "content" => content}, ctx) do
    root = root(ctx)

    case recusa_de_secao_perdida(root, path, content) do
      nil -> escrever(root, path, content)
      msg -> {:error, msg}
    end
  end

  def run(_args, _ctx), do: {:error, "write_file exige `path` e `content`"}

  defp escrever(root, path, content) do
    case WorkspaceFiles.write_file(root, path, content) do
      {:ok, _abs} -> {:ok, "escrito: #{path}"}
      {:error, :traversal} -> {:error, "caminho fora do workspace: #{path}"}
      {:error, reason} -> {:error, "falha ao escrever #{path}: #{inspect(reason)}"}
    end
  end

  # RN-900: um README que já tem a seção da Infra não pode perdê-la por
  # reescrita parcial. Arquivo que não é README, ou sem a seção, passa.
  # shortcut: só cobre README*; escrita pelo terminal (cat >, sed -i) não passa por aqui.
  defp recusa_de_secao_perdida(root, path, content) do
    with true <- Regex.match?(~r/^readme/i, Path.basename(path)),
         {:ok, antigo} <- WorkspaceFiles.read_file(root, path) do
      cond do
        tem_secao?(antigo) and not tem_secao?(content) ->
          "write_file substitui o arquivo inteiro, e #{path} tem a seção \"#{@titulo_secao_de_uso}\" " <>
            "que o conteúdo novo não traz. Arquivo intacto. Para mudar um trecho, reescreva o " <>
            "README completo mantendo essa seção."

        perdidas = rotas_perdidas(antigo, content) ->
          recusa_de_rota(path, perdidas)

        true ->
          nil
      end
    else
      _ -> nil
    end
  end

  # RN-948 (AT-623): cabeçalho de rota (`### GET /links`) do README antigo que
  # o novo não traz.
  @rota ~r/^#+\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*/m

  defp rotas_perdidas(antigo, novo) do
    perdidas = cabecalhos_de_rota(antigo) -- cabecalhos_de_rota(novo)
    if perdidas == [], do: nil, else: perdidas
  end

  defp cabecalhos_de_rota(texto),
    do: @rota |> Regex.scan(texto) |> Enum.map(fn [h] -> h |> String.replace(~r/^#+\s*/, "") end)

  defp recusa_de_rota(path, perdidas) do
    "write_file substitui o arquivo inteiro, e #{path} documenta rotas que o conteúdo novo " <>
      "não traz (#{Enum.join(perdidas, ", ")}). Arquivo intacto. Reescreva o README completo " <>
      "mantendo todas as rotas."
  end

  defp tem_secao?(texto),
    do: Regex.match?(~r/^#+\s*#{Regex.escape(@titulo_secao_de_uso)}\s*$/mu, texto)

  defp root(ctx), do: ctx[:workspace_root] || Workspace.workspace_dir(ctx.project_id)
end
