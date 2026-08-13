defmodule Engine.Harness.Tools.ReadFile do
  @moduledoc "Lê um arquivo dentro do workspace do projeto (traversal bloqueado)."

  @behaviour Engine.Harness.Tool

  alias Engine.Harness.WorkspaceFiles
  alias Engine.Actions.Workspace

  @impl true
  def spec do
    %{
      name: "read_file",
      description: "Lê o conteúdo de um arquivo do workspace do projeto.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "path" => %{"type" => "string", "description" => "caminho relativo ao workspace"}
        },
        "required" => ["path"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"path" => path}, ctx) do
    case WorkspaceFiles.read_file(root(ctx), path) do
      {:ok, content} -> {:ok, truncate(content, path)}
      {:error, :traversal} -> {:error, "caminho fora do workspace: #{path}"}
      {:error, reason} -> {:error, "falha ao ler #{path}: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "read_file exige o argumento `path`"}

  defp root(ctx), do: ctx[:workspace_root] || Workspace.workspace_dir(ctx.project_id)

  @doc false
  # Teto de bytes do CONTEÚDO lido (mesmo espírito do achado S em
  # Engine.Actions.TerminalExecutor.truncate/2, mas por outra porta): o
  # conteúdo lido fica no histórico do laço e viaja em TODO turno seguinte.
  # Sem teto, ler um lockfile/bundle/arquivo gerado grande basta pra estourar
  # `{413, "request entity too large"}` no turno seguinte — mesmo incidente
  # do achado S, agora pelo read_file em vez do terminal. Afeta dev agents E
  # o QA de Performance/Segurança, que só tem ReadFile/SearchWorkspace (sem
  # Terminal, de propósito — não pode rodar comando nenhum).
  #
  # A truncagem mora AQUI (na ferramenta), não em WorkspaceFiles.read_file/2:
  # WorkspaceFiles é a base genérica de acesso a arquivo (usada também por
  # write_file/search), e truncar aí cortaria silenciosamente conteúdo de
  # quem não precisa desse teto. terminal_executor.ex segue o mesmo desenho —
  # trunca em build_result/3 (camada que produz o resultado pro modelo), não
  # em execute/3 (camada genérica de execução).
  #
  # Constante PRÓPRIA (READ_FILE_MAX_BYTES), não reaproveita
  # terminal_output_max_bytes: hoje têm o mesmo valor por coincidência de
  # contexto (32 KiB é o teto que já provou ser seguro pro provider), não por
  # acoplamento — divergir um não deve exigir tocar o outro.
  def truncate(content, path) do
    max = max_bytes()
    raw_bytes = byte_size(content)

    if raw_bytes <= max do
      content
    else
      content
      |> binary_part(0, max)
      |> cortar_utf8_incompleto()
      |> Kernel.<>(marca_de_truncagem(path, max, raw_bytes))
    end
  end

  # A marca é endereçada ao modelo, não ao humano: diz o que sumiu E o que
  # fazer a respeito (mesmo padrão de TerminalExecutor.marca_de_truncagem/2).
  defp marca_de_truncagem(path, max, raw_bytes) do
    "\n\n[arquivo #{path} truncado: mostrando #{max} de #{raw_bytes} bytes. " <>
      "Use search_workspace para localizar um trecho específico em vez de " <>
      "reler o arquivo inteiro.]"
  end

  # Mesma lógica de TerminalExecutor.cortar_utf8_incompleto/1: binary_part/3
  # corta por BYTE e pode partir um caractere multibyte ao meio.
  defp cortar_utf8_incompleto(bin), do: cortar_utf8_incompleto(bin, 3)

  defp cortar_utf8_incompleto(bin, 0), do: bin

  defp cortar_utf8_incompleto(bin, tentativas) do
    if String.valid?(bin) do
      bin
    else
      bin
      |> binary_part(0, byte_size(bin) - 1)
      |> cortar_utf8_incompleto(tentativas - 1)
    end
  end

  defp max_bytes,
    do: Application.get_env(:engine, :read_file_max_bytes, 32_768)
end
