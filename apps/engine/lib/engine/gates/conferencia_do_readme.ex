defmodule Engine.Gates.ConferenciaDoReadme do
  @moduledoc """
  RN-798 (AT-475): quando a entrega toca um README, o QA confere que os
  comandos de script citados nele existem no `package.json` ao lado (o da
  mesma pasta do README, senão o da raiz do worktree). Divergência vira item
  do parecer, como mais uma subespecialidade da área, sem LLM.

  O que é conferido: `npm run <s>`, `npm test`, `npm start`, `pnpm [run] <s>`
  e `yarn [run] <s>`, contra `scripts` do `package.json`. O que fica de FORA,
  declarado: subcomando embutido do gerenciador (`pnpm install`, `npx`,
  `pnpm dlx`…), comando com flag antes do script (`pnpm --filter x test`),
  flags de CLI do próprio projeto e comando que não é de Node. Sem
  `package.json` alcançável, nada é afirmado.
  """

  @embutidos ~w(install i add remove rm uninstall dlx exec create init ci update
                upgrade up why audit publish link unlink x outdated list ls config
                store import prune rebuild pack fetch dedupe env setup help
                version info view whoami login logout cache patch global)

  @padrao ~r/\b(npm|pnpm|yarn)\s+(run\s+)?([A-Za-z0-9:_\-\.]+)/

  @doc """
  `nil` quando a entrega não toca README (ou o diff não veio); senão a lista
  de divergências (vazia quando tudo bate).
  """
  @spec conferir(String.t() | nil, {:ok, [String.t()]} | term()) :: [String.t()] | nil
  def conferir(worktree, {:ok, arquivos}) when is_binary(worktree) do
    case Enum.filter(arquivos, &readme?/1) do
      [] -> nil
      readmes -> Enum.flat_map(readmes, &divergencias(worktree, &1))
    end
  end

  def conferir(_, _), do: nil

  @doc "As divergências de UM README, dado o texto dele e os scripts."
  @spec divergencias_do_texto(String.t(), String.t(), map()) :: [String.t()]
  def divergencias_do_texto(readme, texto, scripts) do
    texto
    |> comandos()
    |> Enum.uniq()
    |> Enum.reject(&Map.has_key?(scripts, elem(&1, 1)))
    |> Enum.map(fn {citado, script} ->
      "#{readme} cita `#{citado}`, mas o package.json não tem o script `#{script}`"
    end)
  end

  defp readme?(caminho), do: caminho |> Path.basename() |> String.downcase() =~ ~r/^readme(\.|$)/

  defp divergencias(worktree, readme) do
    with {:ok, texto} <- File.read(Path.join(worktree, readme)),
         {:ok, scripts} <- scripts(worktree, Path.dirname(readme)) do
      divergencias_do_texto(readme, texto, scripts)
    else
      _ -> []
    end
  end

  defp scripts(worktree, pasta) do
    [Path.join([worktree, pasta, "package.json"]), Path.join(worktree, "package.json")]
    |> Enum.uniq()
    |> Enum.find_value({:error, :sem_package_json}, fn caminho ->
      with {:ok, conteudo} <- File.read(caminho),
           {:ok, %{} = pkg} <- Jason.decode(conteudo) do
        {:ok, Map.get(pkg, "scripts") || %{}}
      else
        _ -> nil
      end
    end)
  end

  defp comandos(texto) do
    @padrao
    |> Regex.scan(texto)
    |> Enum.flat_map(fn [citado, gerenciador, run, nome] ->
      comando(String.trim(citado), gerenciador, run != "", nome)
    end)
  end

  defp comando(_citado, _g, _run, "-" <> _), do: []
  defp comando(citado, "npm", false, nome) when nome in ["test", "start"], do: [{citado, nome}]
  defp comando(_citado, "npm", false, _nome), do: []
  defp comando(citado, _g, true, nome), do: [{citado, nome}]

  defp comando(citado, _g, false, nome),
    do: if(nome in @embutidos, do: [], else: [{citado, nome}])
end
