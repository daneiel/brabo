# ADR 0115 — Pull de modelo do Hugging Face: tabela própria, confirmação em dois passos e allowlist de publicadores oficiais — nunca `proposed_actions`

- **Status:** Aceito
- **Data:** 2026-08-26
- **Contexto:** permite a um owner/maintainer do workspace buscar no Hugging Face Hub e fazer pull de um modelo GGUF para o daemon local do Ollama a partir das Configurações do Projeto/Workspace, fechando uma lacuna para a qual o caminho de LLM local não tinha resposta (obter um modelo que não está entre os poucos embutidos no entrypoint do compose)
- **Referências (sem editar):** [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) ("nunca ativar um modelo descoberto automaticamente" — a regra que esta decisão aplica a uma superfície nova), [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md) (o Ollama como o daemon local que recebe o pull), o ADR original da FASE 1 que introduziu `proposed_actions` e `decide()`

## Contexto

O produto já tem um pipeline para "um agente propõe, um humano decide":
`proposed_actions`, `permissions.json`/`decide()` e as três telas que leem
dele (Aprovações, chat da sessão, Insights). Fazer pull de um modelo do
Hugging Face para o Ollama parecia, na superfície, que poderia caber — é uma
ação com efeito externo real (um download de vários gigabytes, depois a
ativação de um modelo contra o qual outros agentes podem gastar) e o produto
quer uma confirmação deliberada, em dois passos, antes de ela rodar, não um
clique só.

Não cabe, e o descompasso só aparece quando se rastreia em torno do que o
pipeline foi de fato construído.

## Decisão

### `huggingface_model_pull_requests` é uma tabela nova e pequena — não `proposed_actions`

Antes de construir qualquer coisa, o mecanismo rastreou quatro coisas que
`proposed_actions` exige e conferiu se valem aqui:

- `proposed_actions.session_id` é `NOT NULL` (FK para `sessions`, cascade).
  Esta funcionalidade não tem sessão — ela é invocada das Configurações do
  Projeto/Workspace, não do turno de um agente dentro de uma sessão. Encaixá-la
  significaria fabricar uma sessão para uma ação que nada tem a ver com uma.
- `actor_kind`/`actor_id` registram **quem propôs** (`user`/`agent`/`system`),
  e `resolved_policy` é sempre a saída de rodar `decide()` contra
  `permissions.json`/`agent_autonomy` — um estágio de resolução de política
  construído para níveis de autonomia (`auto_approve`/`require_approval`/`deny`)
  sobre o comportamento de **agente**. Aqui o ator que pede o pull **é** o
  humano — já barrado por `@RequireRole('maintainer')` na rota
  (`apps/api/src/interfaces/http/llm/huggingface-models.controller.ts:63-72`)
  — e não há agente a supervisionar. Passá-lo por `decide()` aplicaria a
  semântica de nível de autonomia a um caso que não tem nível de autonomia: um
  maintainer confirmando o próprio pedido uma segunda vez.
- `action_type` é validado contra a união fechada `ActionType` de `decide.ts`,
  e a regra do próprio CLAUDE.md para essa união é direta: um tipo novo
  precisa de uma frase em `apps/web/src/lib/aprovacoes.ts`, e ele aparece nas
  três telas construídas para supervisão de agente. Fabricar uma entrada ali
  para "um humano clicou em confirmar na própria ação de Configurações" a
  exporia numa UI construída para responder a outra pergunta ("o que um agente
  está me pedindo para aprovar") por uma ação que nunca faz essa pergunta.
- A "segunda confirmação explícita" de que esta funcionalidade precisa é um
  portão de UX/segurança sobre uma **ação humana direta**, não um portão de
  aprovação da proposta de um agente — outra forma de "tem certeza", não a
  mesma.

Dado isso, forçar isto para dentro de `proposed_actions` significaria dobrar
um mecanismo construído para supervisionar um agente não confiável sobre um
caso sem agente — acoplando a funcionalidade a semânticas de
`permissions.json`/`agent_autonomy` de que ela não precisa e que nunca foram
desenhadas para respondê-la.

**A tabela nova**, `huggingface_model_pull_requests` (migration
`0053_optimal_sauron.sql`): `id`, `workspace_id` (FK `workspaces`, cascade),
`requested_by` (FK `users`), `repo_id`, `estimated_size_bytes` (anulável —
nunca adivinhado quando o Hub não publica um), `status`
(`huggingface_model_pull_status`: `pending_confirmation` → `confirmed` →
`pulling` → `active` | `failed`), `confirmed_at`, `failed_reason` (sempre
prefixado com o vocabulário de origem do ADR 0020 — `infra`/`modelo`/`código`/
`política`), timestamps e um índice em `workspace_id`
(`apps/api/src/db/schema.ts:2371-2393`).

### A confirmação em dois passos É a máquina de estados, não uma flag a mais

`RequestModelPullUseCase`
(`apps/api/src/application/use-cases/llm/huggingface/request-model-pull.use-case.ts:23`)
cria a linha em `pending_confirmation` e não faz mais nada — nenhuma chamada
de rede, nenhum efeito colateral. Só uma chamada **separada** a
`ConfirmModelPullUseCase`
(`.../huggingface/confirm-model-pull.use-case.ts:45`), alcançável
exclusivamente por `POST .../pull-requests/:id/confirm`, move a linha para
`confirmed` → `pulling` e de fato chama `OllamaProvider.pullModel`. Não há
terceira flag nem coluna registrando "isto foi confirmado" — a própria
transição `pending_confirmation → confirmed` **é** a segunda confirmação, e
`ConfirmModelPullUseCase` recusa (409, `ConflictException`) rodá-la duas
vezes: uma linha que não está mais em `pending_confirmation` não pode ser
confirmada de novo.

### `repoId` viaja no corpo do request, não na rota

O formato real de id do Hub é `<publisher>/<model>` (ex.:
`meta-llama/Llama-3.1-8B-Instruct-GGUF`) — uma `/` dentro do que seria um
segmento de caminho `:repoId` quebra o casamento de rota de segmento único do
Nest/Express. `POST .../pull-requests` o recebe no corpo
(`RequestModelPullDto`), a mesma escolha já feita para caminhos de arquivo em
`apps/api/src/interfaces/http/git/code.controller.ts` pelo mesmo motivo.

### O pull roda de forma síncrona dentro do request HTTP que confirma

`ConfirmModelPullUseCase` espera o download inteiro antes de retornar. A api
não tem executor de jobs em segundo plano alcançável a partir dela — o Oban
mora no engine Elixir, e não existe canal síncrono de comando da api para ele
para isto. Disparar o pull e retornar na hora significaria perder a exceção
não tratada no instante em que a função chamadora retornasse, e o
`markFailed` no `catch` do caso de uso nunca rodaria.
`GET .../pull-requests/:id` existe para quem não quer segurar essa conexão
aberta (um proxy reverso ou gateway muitas vezes estoura o tempo antes de um
download de vários gigabytes terminar) — o pull em si continua rodando no
servidor, haja ou não alguém ainda consultando.

### Allowlist de publicadores oficiais — a regra do ADR 0042, aplicada a um selo novo

`HUGGINFACE_OFFICIAL_PUBLISHERS`
(`apps/api/src/domain/llm/huggingface-official-publishers.ts:17-26`) é uma
lista curta, curada à mão e sensível a maiúsculas de orgs do Hub reconhecidas
como o fabricante de fato do que publicam (`meta-llama`, `google`,
`mistralai`, `microsoft`, `Qwen`, `deepseek-ai`, `openai`, `nvidia`) — a mesma
postura "nunca ativar um modelo descoberto automaticamente, curadoria é sempre
manual" que o ADR 0042 já mantém para o catálogo de LLM, aplicada aqui ao selo
"oficial" em vez de à ativação. `isOfficialPublisher` compara o segmento do
publicador do `repoId` exatamente, sem normalizar maiúsculas: o próprio Hub é
sensível a maiúsculas (`Qwen`, não `qwen`), e normalizar deixaria um reupload
em minúsculas — que *não* é a org oficial — ganhar o selo por acidente.

`SearchHuggingFaceModelsUseCase`
(`.../huggingface/search-huggingface-models.use-case.ts:28`) filtra para
resultados `official: true` **por padrão**; `includeCommunity: true` devolve
todo publicador, cada um marcado `official`/não, e nunca esconde a distinção.
O lado web (`apps/web/src/components/HuggingFaceModelBrowser.tsx:190-203`)
desenha essa escolha como um toggle desligado por padrão mais um banner de
aviso persistente, explícito e em tom de perigo (`Alert tone="danger"`) que só
aparece enquanto resultados da comunidade estão sendo mostrados — o opt-in e o
aviso de risco são o mesmo gesto, nunca uma configuração que alguém liga uma
vez e esquece que está ligada.

## Consequências

**Um desvio de formato de rota que quem chama deve respeitar.** `repoId` é
campo do corpo, nunca interpolado num caminho de URL — documentado na rota e
repetido aqui para que uma edição futura não o "simplifique" de volta para
parâmetro de caminho e reintroduza o defeito da `/` dentro do segmento.

**Um corte real e declarado: sem fila.** O pull síncrono é uma troca
deliberada, não um descuido — sinalizado no próprio comentário do caso de uso
como digno de ADR, que este ADR fecha. Uma fila de verdade em segundo plano na
api é o próximo passo natural se o volume de pulls algum dia justificar a
complexidade a mais; nada aqui impede construí-la depois.

**Modelos baixados por pull recebem preço e ativação do mesmo jeito que
qualquer outro modelo local do Ollama.** `ConfirmModelPullUseCase` insere em
`models` com preço `0`/`manualPricing: false` (espelhando o tratamento que
`sync-model-catalog.use-case.ts` dá a toda outra entrada local do Ollama) e
ativa o modelo **só para o workspace que pediu** via
`WorkspaceModelRepository.setActive`. Isto não é a regra "nunca ativar um
modelo descoberto automaticamente" do ADR 0042 sendo violada — aquela regra
trata de uma sincronização em segundo plano descobrindo algo que ninguém
pediu; aqui a ativação é a consequência direta e rastreável de um humano pedir
este modelo exato duas vezes (pedido, depois confirmação).

**O nome exibido é o `repoId` cru.** O `displayName` de um modelo baixado é o
que o Hub o chamou (ex.: `meta-llama/Llama-3.1-8B-Instruct-GGUF`), nunca
reformatado — deixado como questão de produto/UX para depois, não resolvida
aqui.

**A resposta da busca do Hub não traz estimativa de tamanho hoje.** A
estimativa mostrada na confirmação só vem do que o cliente já sabia quando
chamou `POST .../pull-requests` (`estimatedSizeBytes`, sempre `null` quando
não informado) — o endpoint de busca não preenche uma, então a tela de
confirmação normalmente mostrará "não informado pelo Hub" em vez de um número
real. Coerente com a regra declarada do produto de nunca fabricar uma
estimativa; não é bug, é uma limitação real atual do que a resposta de busca
do Hub expõe.

## Alternativas consideradas

- **Reusar `proposed_actions`.** Rejeitada pelos motivos rastreados em
  Decisão acima: nenhuma sessão onde pendurá-la, um estágio de resolução de
  política construído para níveis de autonomia de agente que não se aplica ao
  pedido do próprio humano, um vocabulário `ActionType` fechado cujas
  superfícies de UI foram construídas para outra pergunta, e uma "segunda
  confirmação" que é portão de segurança de ação direta, não um portão de
  aprovar/negar a proposta de outrem.
- **Uma flag booleana `confirmed` num pedido de passo único, em vez de uma
  máquina de estados.** Rejeitada: o formato de dois requests (`create` e
  depois uma chamada `confirm` separada, barrada por papel nas duas rotas) é o
  que torna a confirmação **explícita e revisitável** — uma flag virada no
  mesmo request da criação colapsaria os dois passos que o produto quer
  explicitamente separados, e a recusa de `ConfirmModelPullUseCase` a
  reconfirmar decorre diretamente de modelá-la como estados em vez de flag.
- **Casamento de publicador sem sensibilidade a maiúsculas para o selo
  oficial.** Rejeitada: o próprio Hub trata nomes de publicador como sensíveis
  a maiúsculas, e normalizar entregaria o selo "oficial" a um reupload em
  minúsculas do nome de uma org oficial — exatamente o tipo de nome que um
  publicador terceiro menos cuidadoso escolheria de propósito.
