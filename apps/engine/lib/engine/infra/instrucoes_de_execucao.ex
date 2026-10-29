defmodule Engine.Infra.InstrucoesDeExecucao do
  @moduledoc """
  Valida o campo `run` de `propose_infra_pr` (RN-851, ADR 0213): como o
  usuário sobe o app entregue na própria máquina. A régua é a do contrato da
  AT-517 e a api a repete ao executar `open_infra_pr` — esta metade existe
  para a recusa voltar ao MODELO como resultado de ferramenta (RN-163), antes
  do HALT e do Workflows pago, com o motivo nomeado.

  - `command`: texto não vazio, até 300 caracteres;
  - `urls`: 1 a 5 itens `%{label, url, kind}`, `label` até 60 caracteres,
    `kind` em `api_docs | web`, `url` começando com `http://localhost:` ou
    `http://127.0.0.1:`;
  - `envExample`: booleano;
  - `app` (opcional, AT-610): `%{command, port}` — o comando que sobe o app
    DENTRO do container de trabalho, até 300 caracteres sem quebra de linha
    nem `\0`, e a porta INTERNA (inteiro de 1024 a 65535).
  """

  @kinds ~w(api_docs web)
  @prefixos ["http://localhost:", "http://127.0.0.1:"]

  @spec validar(term()) :: {:ok, map()} | {:error, String.t()}
  def validar(%{} = run) do
    with :ok <- comando(Map.get(run, "command")),
         :ok <- urls(Map.get(run, "urls")),
         :ok <- env_example(Map.get(run, "envExample")),
         :ok <- app(Map.get(run, "app")) do
      {:ok,
       run
       |> Map.take(["command", "urls", "envExample", "app"])
       |> Map.reject(fn {_, v} -> is_nil(v) end)}
    end
  end

  def validar(nil),
    do:
      recusa(
        "falta o campo obrigatório `run` ({command, urls, envExample}): como o usuário sobe o app na máquina dele"
      )

  def validar(_), do: recusa("`run` precisa ser um objeto {command, urls, envExample}")

  defp comando(c) when is_binary(c) do
    cond do
      String.trim(c) == "" -> recusa("`run.command` está vazio")
      String.length(c) > 300 -> recusa("`run.command` passa de 300 caracteres")
      true -> :ok
    end
  end

  defp comando(_), do: recusa("`run.command` precisa ser texto")

  defp urls(lista) when is_list(lista) and length(lista) in 1..5 do
    lista |> Enum.with_index() |> Enum.reduce_while(:ok, fn {u, i}, :ok -> url(u, i) end)
  end

  defp urls(_), do: recusa("`run.urls` precisa ser uma lista de 1 a 5 itens")

  defp url(%{"label" => l, "url" => u, "kind" => k}, i)
       when is_binary(l) and is_binary(u) and is_binary(k) do
    cond do
      String.trim(l) == "" or String.length(l) > 60 ->
        {:halt, recusa("`run.urls[#{i}].label` precisa ter de 1 a 60 caracteres")}

      k not in @kinds ->
        {:halt, recusa("`run.urls[#{i}].kind` é `#{k}`; aceitos: api_docs, web")}

      not String.starts_with?(u, @prefixos) ->
        {:halt,
         recusa(
           "`run.urls[#{i}].url` é `#{u}`; precisa começar com http://localhost: ou http://127.0.0.1:"
         )}

      # RN-863 (AT-524): `api_docs` é sempre a UI Swagger em `/docs`, nunca
      # uma rota de negócio — a mesma régua de `recusaDoRun` na api.
      k == "api_docs" and not String.ends_with?(u, "/docs") ->
        {:halt,
         recusa(
           "`run.urls[#{i}].url` é `#{u}`; `api_docs` aponta para `/docs` (a UI Swagger), nunca rota de negócio"
         )}

      true ->
        {:cont, :ok}
    end
  end

  defp url(_, i), do: {:halt, recusa("`run.urls[#{i}]` exige label, url e kind (texto)")}

  defp env_example(b) when is_boolean(b), do: :ok
  defp env_example(_), do: recusa("`run.envExample` precisa ser booleano")

  defp app(nil), do: :ok

  defp app(%{} = app) do
    with :ok <- app_comando(Map.get(app, "command")),
         :ok <- app_porta(Map.get(app, "port")),
         do: :ok
  end

  defp app(_), do: recusa("`run.app` precisa ser um objeto {command, port}")

  defp app_comando(c) when is_binary(c) do
    cond do
      String.trim(c) == "" ->
        recusa("`run.app.command` está vazio")

      String.length(c) > 300 ->
        recusa("`run.app.command` passa de 300 caracteres")

      String.contains?(c, ["\n", "\r", "\0"]) ->
        recusa("`run.app.command` não pode ter quebra de linha nem byte nulo")

      true ->
        :ok
    end
  end

  defp app_comando(_), do: recusa("`run.app.command` precisa ser texto")

  defp app_porta(p) when is_integer(p) and p in 1024..65_535, do: :ok

  defp app_porta(_),
    do: recusa("`run.app.port` precisa ser um inteiro de 1024 a 65535 (porta INTERNA)")

  defp recusa(motivo), do: {:error, "propose_infra_pr recusada: " <> motivo <> "."}
end
