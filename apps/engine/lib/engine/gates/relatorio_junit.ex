defmodule Engine.Gates.RelatorioJunit do
  @moduledoc """
  AT-687 (RN-996): lê o relatório JUnit que o gate de QA pediu e o resume em
  `execucaoDeTestes`, campo ADITIVO do `qa_verdict` (o veredito externo não
  muda, ADR 0054). Quem lê é o ENGINE, nunca o modelo declarando.

  Contrato: `%{fonte: "junit", total, passaram, falharam, pulados, duracaoMs,
  suites: [%{nome, casos: [%{nome, status, duracaoMs, mensagem?}]}],
  casosOmitidos}` ou `%{indisponivel: motivo, origem:, detalhe?}`, com motivo
  `sem_relatorio | relatorio_invalido | modo_runner`. "Sem relatório" nunca
  vira "0 testes" (RN-470).

  Em `runner` o arquivo vem pelo canal do runner (o `exec` já existente,
  `RunnerRouter`), sem operação nova no contrato.

  Segurança: DOCTYPE/ENTITY é recusado antes do parser (XXE); teto de 2 MiB e
  de 20 000 casos; o parser é o SAX do `:xmerl` (não cria átomos).
  Teto de gravação (ADR 0060): 200 casos, falhas primeiro; 20 mensagens de
  500 caracteres; nomes de 200.
  """

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Runners.RunnerRouter

  @max_bytes 2 * 1024 * 1024
  @max_casos_lidos 20_000
  @max_casos 200
  @max_mensagens 20
  @max_mensagem 500
  @max_nome 200
  @timeout_runner_ms 20_000

  @doc "Lê o relatório citado em `args[\"relatorioDeTestes\"]` e devolve o campo do parecer."
  def ler(%{args: args} = ctx) do
    case Map.get(args, "relatorioDeTestes") do
      rel when is_binary(rel) and rel != "" -> ler_caminho(ctx, rel)
      _ -> indisponivel("sem_relatorio", "modelo")
    end
  end

  def ler(_), do: indisponivel("sem_relatorio", "modelo")

  defp ler_caminho(ctx, rel) do
    cond do
      not Regex.match?(~r{\A[\w./-]+\z}, rel) or String.contains?(rel, "..") or
          String.starts_with?(rel, "/") ->
        indisponivel("relatorio_invalido", "modelo", "caminho recusado")

      runner?(ctx) ->
        via_runner(ctx, rel)

      true ->
        via_disco(ctx, rel)
    end
  end

  defp runner?(%{project_id: id}) do
    match?(%{execution_mode: "runner"}, Engine.Projects.Project.get(id))
  rescue
    _ -> false
  end

  defp runner?(_), do: false

  defp via_disco(%{workspace_root: raiz}, rel) when is_binary(raiz) do
    with {:ok, abs} <- WorkspaceFiles.safe_path(raiz, rel),
         {:ok, %{size: tam}} when tam <= @max_bytes <- File.stat(abs),
         {:ok, bin} <- File.read(abs) do
      File.rm(abs)
      parse_ou_invalido(bin)
    else
      {:ok, %{size: _}} -> indisponivel("relatorio_invalido", "codigo", "acima de 2 MiB")
      {:error, :enoent} -> indisponivel("sem_relatorio", "modelo")
      {:error, motivo} -> indisponivel("sem_relatorio", "infra", inspect(motivo))
    end
  end

  defp via_disco(_, _), do: indisponivel("sem_relatorio", "infra", "sem workspace")

  # `head -c` limita o que viaja; o arquivo é apagado depois de lido.
  defp via_runner(%{project_id: id, workspace_root: raiz}, rel) do
    cmd = "head -c #{@max_bytes + 1} #{rel} && rm -f #{rel}"

    case RunnerRouter.exec(id, cmd, raiz, @timeout_runner_ms) do
      {:ok, %{"exitCode" => 0, "output" => out}} when is_binary(out) ->
        if byte_size(out) > @max_bytes,
          do: indisponivel("relatorio_invalido", "codigo", "acima de 2 MiB"),
          else: parse_ou_invalido(out)

      {:ok, _} ->
        indisponivel("sem_relatorio", "modelo")

      {:error, motivo} ->
        indisponivel("modo_runner", "infra", "runner: #{inspect(motivo)}")
    end
  end

  defp parse_ou_invalido(bin) do
    case parse(bin) do
      {:ok, execucao} -> execucao
      {:error, motivo} -> indisponivel("relatorio_invalido", "codigo", to_string(motivo))
    end
  end

  defp indisponivel(motivo, origem, detalhe \\ nil) do
    base = %{indisponivel: motivo, origem: origem}
    if detalhe, do: Map.put(base, :detalhe, detalhe), else: base
  end

  @doc "Parseia o JUnit XML. `{:ok, execucao} | {:error, motivo}`; nunca lança."
  def parse(bin) when is_binary(bin) do
    cond do
      byte_size(bin) > @max_bytes -> {:error, :acima_do_teto}
      Regex.match?(~r/<!(DOCTYPE|ENTITY)/i, bin) -> {:error, :doctype_recusado}
      true -> sax(bin)
    end
  end

  def parse(_), do: {:error, :nao_e_binario}

  defp sax(bin) do
    estado = %{suites: [], caso: nil, texto: [], n: 0}

    case :xmerl_sax_parser.stream(bin, event_fun: &evento/3, event_state: estado) do
      {:ok, %{suites: [], n: 0}, _} -> {:error, :sem_casos}
      {:ok, %{n: n}, _} when n > @max_casos_lidos -> {:error, :casos_demais}
      {:ok, e, _} -> {:ok, resumir(Enum.reverse(e.suites))}
      _ -> {:error, :xml_invalido}
    end
  catch
    _, _ -> {:error, :xml_invalido}
  end

  # shortcut: testsuite aninhado vira suíte própria e casos seguem a última
  # aberta; vale para os reporters comuns, que não aninham casos.
  defp evento({:startElement, _, ~c"testsuite", _, attrs}, _loc, e),
    do: %{e | suites: [%{nome: attr(attrs, ~c"name"), casos: []} | e.suites]}

  defp evento({:startElement, _, ~c"testcase", _, attrs}, _loc, e) do
    nome =
      [attr(attrs, ~c"classname"), attr(attrs, ~c"name")]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join(" > ")

    caso = %{
      nome: cortar(nome, @max_nome),
      status: "passou",
      duracaoMs: ms(attr(attrs, ~c"time"))
    }

    %{e | caso: caso, n: e.n + 1}
  end

  defp evento({:startElement, _, tag, _, attrs}, _loc, %{caso: c} = e)
       when tag in [~c"failure", ~c"error"] and c != nil,
       do: %{
         e
         | caso: Map.merge(c, %{status: "falhou", mensagem: attr(attrs, ~c"message")}),
           texto: []
       }

  defp evento({:startElement, _, ~c"skipped", _, _}, _loc, %{caso: c} = e) when c != nil,
    do: %{e | caso: %{c | status: "pulado"}}

  defp evento({:characters, txt}, _loc, e), do: %{e | texto: [txt | e.texto]}

  defp evento({:endElement, _, tag, _}, _loc, %{caso: c} = e)
       when tag in [~c"failure", ~c"error"] and c != nil do
    corpo = e.texto |> Enum.reverse() |> to_string() |> String.trim()
    msg = if Map.get(c, :mensagem, "") == "", do: corpo, else: c.mensagem
    %{e | caso: Map.put(c, :mensagem, msg), texto: []}
  end

  defp evento({:endElement, _, ~c"testcase", _}, _loc, %{caso: c, suites: [s | resto]} = e)
       when c != nil do
    # acima do teto só contamos: o parse segue barato e termina em erro.
    s = if e.n > @max_casos_lidos, do: s, else: %{s | casos: [c | s.casos]}
    %{e | suites: [s | resto], caso: nil}
  end

  defp evento(_, _loc, e), do: e

  defp attr(attrs, nome) do
    case Enum.find(attrs, fn {_, _, n, _} -> n == nome end) do
      {_, _, _, v} -> to_string(v)
      nil -> ""
    end
  end

  defp ms(""), do: 0

  defp ms(s) do
    case Float.parse(s) do
      {f, _} -> round(f * 1000)
      :error -> 0
    end
  end

  defp cortar(s, n), do: String.slice(s, 0, n)

  defp resumir(suites) do
    casos = for {s, i} <- Enum.with_index(suites), c <- Enum.reverse(s.casos), do: {i, c}
    cont = Enum.frequencies_by(casos, fn {_, c} -> c.status end)
    total = length(casos)

    # sort_by é estável: falhas primeiro, a ordem do relatório dentro de cada grupo.
    gravados =
      casos
      |> Enum.sort_by(fn {_, c} -> if c.status == "falhou", do: 0, else: 1 end)
      |> Enum.take(@max_casos)
      |> limitar_mensagens()

    nomes = suites |> Enum.with_index() |> Map.new(fn {s, i} -> {i, s.nome} end)

    %{
      fonte: "junit",
      total: total,
      passaram: Map.get(cont, "passou", 0),
      falharam: Map.get(cont, "falhou", 0),
      pulados: Map.get(cont, "pulado", 0),
      duracaoMs: casos |> Enum.map(fn {_, c} -> c.duracaoMs end) |> Enum.sum(),
      suites:
        gravados
        |> Enum.group_by(fn {i, _} -> i end, fn {_, c} -> c end)
        |> Enum.sort_by(fn {i, _} -> i end)
        |> Enum.map(fn {i, cs} -> %{nome: cortar(nomes[i], @max_nome), casos: cs} end),
      casosOmitidos: total - length(gravados)
    }
  end

  defp limitar_mensagens(casos) do
    {saida, _} =
      Enum.map_reduce(casos, 0, fn {i, c}, n ->
        cond do
          c.status != "falhou" ->
            {{i, Map.delete(c, :mensagem)}, n}

          n < @max_mensagens ->
            {{i, Map.update(c, :mensagem, "", &cortar(&1, @max_mensagem))}, n + 1}

          true ->
            {{i, Map.delete(c, :mensagem)}, n}
        end
      end)

    saida
  end
end
