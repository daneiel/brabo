defmodule Engine.Harness.AmbienteDoAgente do
  @moduledoc """
  ONDE o agente de execução está (RN-706, AT-379/AT-378): a pasta real em que
  o `terminal` roda, a imagem e a rede do container, que git no terminal não é
  o caminho, e o módulo do dev agent — entregue como mensagem `system`
  EFÊMERA, pelo MESMO molde do idioma (`Engine.Harness.IdiomaDaResposta`,
  RN-622) e do perfil do autor (`Engine.Harness.PerfilDoAutor`, RN-680):
  nunca em `state.messages`, nunca por servidor.

  Medido no uso real (02/10): sem isso, `dev-api` e `qa-automacao` rodavam
  `cd /workspace` (pasta que não existe — palpite do modelo, nenhum prompt a
  cita) e `git status` numa imagem sem git (exit 127); e o `dev-api` recriava
  `package.json` e os arquivos do módulo `catalog`.

  Fonte ÚNICA: `com_ambiente/2` roda em `Engine.Harness.ToolLoop.Impl.run/1`
  (o laço dos dev agents e dos subagentes de QA), deriva o texto do `ctx`
  (`workspace_root`, `module`), do container REGISTRADO
  (`ProjectContainerLifecycle.running?/1`) e da imagem decidida (o último
  `artifact.project_image`), e o põe no dicionário do processo; a fachada
  `Engine.Sessions.EngineApiClient` o acrescenta. A pasta é traduzida para
  `/work` pela MESMA regra do `TerminalExecutor` (`cwd_para_container`). Sem
  container `running`, o texto DIZ isso e não afirma `/work`. Só para
  `dev-*` e `qa-*`; teto de `teto_de_caracteres/0`.
  """

  import Ecto.Query

  alias Engine.Actions.Workspace
  alias Engine.Containers.ProjectContainerLifecycle
  alias Engine.Repo

  @chave :brabo_ambiente_do_agente
  @teto 1200
  @ponto_de_montagem "/work"

  @doc "O teto em caracteres do texto acrescentado."
  def teto_de_caracteres, do: @teto

  @doc "O agente recebe a mensagem de ambiente? Só dev agents e subagentes de QA."
  def elegivel?("dev-" <> _), do: true
  def elegivel?("qa-" <> _), do: true
  def elegivel?(_), do: false

  @doc """
  Roda `fun` com o ambiente do `ctx` no dicionário do processo, restaurando o
  anterior ao sair. Falha de leitura vira ausência — nunca derruba o turno.
  """
  def com_ambiente(ctx, fun) when is_function(fun, 0) do
    anterior = Process.get(@chave)

    case texto_do_ctx(ctx) do
      nil -> Process.delete(@chave)
      texto -> Process.put(@chave, texto)
    end

    try do
      fun.()
    after
      if anterior, do: Process.put(@chave, anterior), else: Process.delete(@chave)
    end
  end

  @doc "A lista com a mensagem de ambiente no FIM, ou intacta sem ambiente."
  @spec anexar([map()], String.t()) :: [map()]
  def anexar(messages, agent) when is_list(messages) do
    case Process.get(@chave) do
      texto when is_binary(texto) and texto != "" ->
        if elegivel?(agent),
          do: messages ++ [%{"role" => "system", "content" => texto}],
          else: messages

      _ ->
        messages
    end
  end

  def anexar(messages, _agent), do: messages

  defp texto_do_ctx(%{agent: agent, project_id: project_id} = ctx)
       when is_binary(agent) and is_binary(project_id) do
    if elegivel?(agent) do
      montar(%{
        cwd: Map.get(ctx, :workspace_root),
        raiz: Workspace.workspace_dir(project_id),
        container_running: ProjectContainerLifecycle.running?(project_id),
        imagem: imagem_decidida(project_id),
        modulo: Map.get(ctx, :module)
      })
    end
  rescue
    _ -> nil
  catch
    :exit, _ -> nil
  end

  defp texto_do_ctx(_), do: nil

  @doc """
  O texto, PURO. `cwd`/`raiz` são caminhos do HOST; `imagem` é o payload do
  último `artifact.project_image` (ou `nil`).
  """
  def montar(%{cwd: cwd, raiz: raiz, container_running: running} = dados) do
    texto =
      [
        "Ambiente de execução (fato do sistema, não suposição):",
        pasta(cwd, raiz, running),
        imagem_e_rede(Map.get(dados, :imagem), running),
        "Git: NÃO rode `git` no terminal (a imagem pode não ter git, e o terminal " <>
          "não é o caminho de commit). Use as ações tipadas `git_commit`, " <>
          "`git_push` e `pr_open`.",
        "Segredos e senhas de teste: gere em tempo de execução (ex.: " <>
          "`crypto.randomUUID()`, variável de ambiente), nunca literal no código — " <>
          "o SecOps reprova literal, e não há allowlist nem `.gitleaksignore`.",
        modulo(Map.get(dados, :modulo))
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("\n")

    if String.length(texto) > @teto,
      do: String.slice(texto, 0, @teto - 1) <> "…",
      else: texto
  end

  defp pasta(cwd, raiz, true) when is_binary(cwd) and is_binary(raiz) do
    "Pasta de trabalho (o `terminal` já roda nela): #{traduzir(cwd, raiz)}. " <>
      "Não use `cd` para outra pasta (como /workspace): ela não existe no container."
  end

  defp pasta(_cwd, _raiz, true),
    do:
      "Pasta de trabalho: o `terminal` roda dentro do container, sob " <>
        "#{@ponto_de_montagem}. Não use `cd` para outra pasta."

  defp pasta(_cwd, _raiz, _),
    do:
      "Container: o projeto NÃO tem container `running` registrado — o " <>
        "`terminal` será recusado até a Infra subi-lo. Não suponha caminho de " <>
        "pasta; use caminhos relativos."

  defp traduzir(cwd, raiz) do
    cond do
      cwd == raiz ->
        @ponto_de_montagem

      String.starts_with?(cwd, raiz <> "/") ->
        @ponto_de_montagem <> String.trim_leading(cwd, raiz)

      true ->
        cwd
    end
  end

  defp imagem_e_rede(%{} = img, running) do
    case Map.get(img, "image") do
      imagem when is_binary(imagem) and imagem != "" ->
        rede = Map.get(img, "network") || "none"

        rede_txt =
          if rede == "none",
            do: "rede `none` (sem internet: nada de instalar pacote de registry)",
            else: "rede `#{rede}`"

        prefixo = if running, do: "Container", else: "Imagem decidida"
        "#{prefixo}: imagem `#{imagem}`, #{rede_txt}. O runtime disponível é o dessa imagem."

      _ ->
        nil
    end
  end

  defp imagem_e_rede(_, _), do: nil

  defp modulo(m) when is_binary(m) and m != "" do
    "Seu módulo: `#{m}`. Escreva só arquivos do seu módulo. O que você CONSOME " <>
      "de outro módulo vem do contrato (`listar_contratos_de_modulos`): use " <>
      "stub/mock, nunca reimplemente o módulo alheio. Arquivos de raiz " <>
      "compartilhados (`package.json`, lockfile) que já existem na `dev` não se " <>
      "recriam: edite o mínimo."
  end

  defp modulo(_), do: nil

  defp imagem_decidida(project_id) do
    Repo.one(
      from(e in Engine.SessionEvents.Event,
        join: s in Engine.Sessions.ProjectSession,
        on: e.session_id == s.id,
        where: s.project_id == type(^project_id, :binary_id),
        where: e.type == "artifact.project_image",
        order_by: [desc: e.created_at],
        limit: 1,
        select: e.payload
      )
    )
  end
end
