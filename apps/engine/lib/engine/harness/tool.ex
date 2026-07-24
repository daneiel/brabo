defmodule Engine.Harness.Tool do
  @moduledoc """
  Contrato de uma ferramenta do ToolLoop. `spec/0` descreve a ferramenta pro
  modelo (name/description/parameters em JSON Schema). `category/0` decide o
  despacho:

    * `:direct`  — o engine executa em processo (`run/2`) — read_file,
      search_workspace, emit_artifact, write_file dentro da whitelist.
    * `:pipeline` — passa pelo pipeline de ações (proposed_action na api) via
      o hook `:pre_tool_use` — terminal, e write_file fora da whitelist. Pra
      essas, o resultado vem do hook, não de `run/2`.

  `run(args, ctx)` recebe os argumentos (map com chaves string, do tool call)
  e o contexto do loop (`%{project_id, session_id, agent, ...}`).
  """

  @callback spec() :: %{name: String.t(), description: String.t(), parameters: map()}
  @callback category() :: :direct | :pipeline
  @callback run(args :: map(), ctx :: map()) :: {:ok, String.t()} | {:error, term()}
end
