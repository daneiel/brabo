defmodule Engine.Harness.Iteracoes do
  @moduledoc """
  O teto de voltas do laço de ferramenta, POR TIPO DE AGENTE (achado X, FASE
  14d, [ADR 0053]).

  O teto nasceu global e vale `8` — número que veio de agente CONVERSACIONAL.
  A validação real da 13b mostrou que ele não cabe em quem trabalha: com `8` o
  dev agent gastou tudo explorando o repositório e nunca escreveu um arquivo;
  com `25`, escreveu três e rodou os testes. O sintoma era
  `limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
  praticamente inútil, porque o modelo nunca chegou a julgar nada.

  **Subir o default global seria a correção errada**, e é o ponto desta peça: o
  Criativo não precisa de 60 iterações para conversar, e o teto também é uma
  trava contra laço infinito. Quem trabalha mais ganha mais volta; quem
  conversa continua em `8`.

  ## Quem pode subir, e por quê

  A pergunta que decide não é "este agente trabalha muito", é **"o que mais
  segura o custo dele além do teto"**. O teto de iterações é a trava CONTRA
  LAÇO INFINITO; a trava de GASTO é o `token_budget_micros`.

  - `:execucao` (dev agents) e `:gate` (subagentes de QA) rodam com o
    `task_budget_micros` da task — o gasto tem dono e teto próprios, então
    afrouxar as voltas não afrouxa a conta.
  - Todo o resto fica em `:conversacional`. `infra-workflows` está aqui de
    propósito, mesmo trabalhando com ferramenta: ele roda **sem**
    `token_budget_micros` (`Engine.Infra.WorkflowsAgent`), e para ele o teto de
    iterações é a única trava de custo que existe. Subi-lo multiplicaria o pior
    caso sem nada por baixo para segurar.

  ## Sobre `dev-lead`

  Os dev agents são `dev-<modulo>` (e `dev-<modulo>-2`), o que faz o prefixo
  `dev-` ser o discriminador natural. O **Dev Lead** do ADR 0053 quebraria
  isso: ele decide e delega, não escreve código. Está tratado ANTES do prefixo,
  e coberto por teste, para o agente não nascer com o teto do trabalho pesado
  por acidente de nomenclatura.
  """

  @type tipo :: :execucao | :gate | :conversacional

  @conversacional 8
  @execucao 60
  @gate 60

  @doc """
  O tipo de um agente, a partir do identificador que ele passa no `ctx`.

  Desconhecido cai em `:conversacional` — o teto mais BAIXO. Errar para o lado
  barato é o default certo aqui: um agente novo que precise de mais voltas
  aparece como `limite de iterações atingido` e é corrigido; um que ganhe 60
  por engano gasta calado.
  """
  @spec tipo(String.t() | atom() | nil) :: tipo()
  def tipo(nil), do: :conversacional
  def tipo(agente) when is_atom(agente), do: agente |> Atom.to_string() |> tipo()

  # ANTES do prefixo `dev-`: o lead decide, não escreve.
  def tipo("dev-lead"), do: :conversacional
  def tipo("dev-" <> _), do: :execucao
  def tipo("qa-automacao"), do: :gate
  def tipo("qa-performance-seguranca"), do: :gate
  def tipo(_outro), do: :conversacional

  @doc "O teto de iterações do agente."
  @spec teto(String.t() | atom() | nil) :: pos_integer()
  def teto(agente), do: agente |> tipo() |> teto_do_tipo()

  @doc """
  O teto de um tipo, sobrescrevível por variável de ambiente.

  `:conversacional` lê `:tool_loop_max_iterations` — a MESMA chave de sempre,
  para quem já ajustava o teto global não ter o ajuste ignorado em silêncio.
  """
  @spec teto_do_tipo(tipo()) :: pos_integer()
  def teto_do_tipo(:execucao),
    do: Application.get_env(:engine, :tool_loop_max_iterations_execucao, @execucao)

  def teto_do_tipo(:gate),
    do: Application.get_env(:engine, :tool_loop_max_iterations_gate, @gate)

  def teto_do_tipo(:conversacional),
    do: Application.get_env(:engine, :tool_loop_max_iterations, @conversacional)
end
