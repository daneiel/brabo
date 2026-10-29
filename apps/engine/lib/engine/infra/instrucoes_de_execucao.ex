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
    nem `\0`, e a porta INTERNA (inteiro de 1024 a 65535);
  - `qa` (opcional, AT-612, RN-941): `%{services: [...]}`, até 6 serviços
    `%{name, image, env?, tmpfs?, user?, command?, shared?}` — a régua de
    `recusaDoQa` na api. `user` é `"<uid>:<gid>"` com inteiros diferentes de 0
    (nunca root); `command` são até 16 argumentos (200 caracteres, uma linha)
    passados depois da imagem. `nil` vale como ausente.
  """

  @kinds ~w(api_docs web)
  @prefixos ["http://localhost:", "http://127.0.0.1:"]

  @spec validar(term()) :: {:ok, map()} | {:error, String.t()}
  def validar(%{} = run) do
    with :ok <- comando(Map.get(run, "command")),
         :ok <- urls(Map.get(run, "urls")),
         :ok <- env_example(Map.get(run, "envExample")),
         :ok <- app(Map.get(run, "app")),
         :ok <- qa(Map.get(run, "qa")) do
      {:ok,
       run
       |> Map.take(["command", "urls", "envExample", "app", "qa"])
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

  defp qa(nil), do: :ok

  defp qa(%{"services" => servicos}) when is_list(servicos) and length(servicos) <= 6 do
    servicos
    |> Enum.with_index()
    |> Enum.reduce_while(MapSet.new(), fn {s, i}, nomes ->
      case servico_de_qa(s, "run.qa.services[#{i}]", nomes) do
        {:ok, nomes} -> {:cont, nomes}
        erro -> {:halt, erro}
      end
    end)
    |> case do
      %MapSet{} -> :ok
      erro -> erro
    end
  end

  defp qa(_), do: recusa("`run.qa` precisa ser {services: lista de até 6 serviços}")

  defp servico_de_qa(%{} = s, ref, nomes) do
    nome = Map.get(s, "name")

    with :ok <- qa_nome(nome, ref, nomes),
         :ok <- qa_imagem(Map.get(s, "image"), ref),
         :ok <- qa_usuario(Map.get(s, "user"), ref),
         :ok <- qa_comando(Map.get(s, "command"), ref) do
      {:ok, MapSet.put(nomes, nome)}
    end
  end

  defp servico_de_qa(_, ref, _), do: recusa("`#{ref}` precisa ser {name, image, ...}")

  defp qa_nome(n, ref, nomes) when is_binary(n) do
    cond do
      not Regex.match?(~r/^[a-z][a-z0-9-]{0,31}$/, n) ->
        recusa("`#{ref}.name` precisa casar [a-z][a-z0-9-]{0,31}")

      MapSet.member?(nomes, n) ->
        recusa("`#{ref}.name` repetido: #{n}")

      true ->
        :ok
    end
  end

  defp qa_nome(_, ref, _), do: recusa("`#{ref}.name` precisa ser texto")

  defp qa_imagem(i, ref) do
    if is_binary(i) and Regex.match?(~r/@sha256:[0-9a-f]{64}$/, i),
      do: :ok,
      else: recusa("`#{ref}.image` precisa trazer digest (@sha256:<64 hex>)")
  end

  defp qa_usuario(nil, _), do: :ok

  defp qa_usuario(u, ref) do
    if is_binary(u) and Regex.match?(~r/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/, u),
      do: :ok,
      else: recusa("`#{ref}.user` precisa ser \"<uid>:<gid>\" com inteiros diferentes de 0")
  end

  defp qa_comando(nil, _), do: :ok

  defp qa_comando(c, ref) when is_list(c) and length(c) in 1..16 do
    if Enum.all?(c, &argumento_valido?/1),
      do: :ok,
      else:
        recusa("`#{ref}.command` tem argumento inválido (texto de 1 a 200 caracteres, uma linha)")
  end

  defp qa_comando(_, ref),
    do: recusa("`#{ref}.command` precisa ser uma lista de 1 a 16 argumentos")

  defp argumento_valido?(a),
    do:
      is_binary(a) and a != "" and String.length(a) <= 200 and
        not String.contains?(a, ["\n", "\r", "\0"])

  defp recusa(motivo), do: {:error, "propose_infra_pr recusada: " <> motivo <> "."}
end
