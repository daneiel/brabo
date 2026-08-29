# 0042 — Catálogo vivo, ciclo de vida do modelo e preço auditável

## Contexto

O [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) entregou
a base OpenAI-compatível, o contrato de providers e as capabilities por modelo.
Faltava a outra metade da Fase 9: descobrir modelos sozinho, saber o que fazer
quando um deles some, e mudar preço sem estragar o histórico.

A exploração antes de codar encontrou três coisas que redefiniram o trabalho.

### O custo histórico já estava congelado — o buraco era outro

O escopo pedia um teste provando que "mudar o preço não altera o custo de
ontem". Esse teste passaria hoje, vazio: `calculateCostMicros` roda no instante
da chamada e o resultado vira `token_usage.cost_micros`; nada recalcula depois.

O buraco real é que `token_usage` **não guardava o preço** que produziu o custo.
Um valor antigo era imutável, mas não **reproduzível**: `tokens × preço` deixava
de fechar assim que alguém corrigisse a linha de `models`, e não havia como
distinguir "o custo está certo" de "o custo está errado desde sempre".

### `is_active` era decorativo

A coluna existia desde a Fase 1 e era lida em **um** lugar: `listActive()`.
`findById` e `findCandidates` a ignoravam. Desativar um modelo não impedia
binding novo, não interrompia binding existente, e a chamada continuava sendo
feita e cobrada. A tela dizia "desativado" e o sistema não concordava.

### Não existia fallback por disponibilidade

`binding-resolver.ts` recebia `{scope, modelId}` e nada mais — não conhecia o
modelo. A cascata era sobre ESCOPOS, nunca sobre o estado do modelo apontado. Um
binding para um modelo que o provider tivesse removido resolveria normalmente e
falharia só na chamada, com um 404 do vendor.

## Decisão

### Dois eixos independentes, não um estado só

| coluna | quem escreve | pergunta que responde |
| --- | --- | --- |
| `models.is_active` | o owner, pela tela de curadoria | "eu quero usar este modelo?" |
| `models.availability` | o sync, sozinho | "este modelo ainda existe lá?" |

Um estado só não daria conta: se o sync escrevesse em `is_active`, um modelo que
sumisse por uma hora voltaria **desligado**, perdendo a curadoria; se o owner
escrevesse em `availability`, ele poderia "reativar" um modelo que não existe
mais do outro lado. O cruzamento dos dois é o que gera o aviso na tela.

O `set` do upsert do repositório **não inclui `is_active`** — é a linha que
garante a regra: o sync reencontrando um modelo não pode religar o que alguém
desligou de propósito.

### Modelo descoberto entra INATIVO, modelo sumido é marcado e preservado

Formalizado na [RN-043](../business-rules/custo.md#rn-043). Deletar nunca é opção:
`model_bindings` e `token_usage` apontam para a linha.

A terceira regra é a que menos aparece e mais importa: **provider que falhou não
indisponibiliza nada.** Um 401 significa "não sei o que tem lá". Tratar isso
como catálogo vazio marcaria todos os modelos daquele provider como sumidos e
derrubaria todos os bindings de uma vez — por causa de uma chave revogada. O
provider é PULADO, com a origem da falha (`infra` | `modelo`) no relatório, no
vocabulário do [ADR 0020](0020-destravar-gates-qa-secops.md).

Pela mesma razão, o `listModels` da base **lança** quando a capability não está
declarada, em vez de devolver `[]`: lista vazia é indistinguível de "o provider
não tem modelo nenhum", e o sync leria isso como "sumiram todos".

### A cascata revalida capability a cada nível

`resolveBinding` passou a receber `{availability, supportsToolCalling}` junto do
id e devolve `skipped[]` — o que foi descartado e por quê.

O ponto não óbvio: quando o turno carrega ferramentas, o filtro de
`supports_tool_calling` vale para **todo** candidato, não só para o primeiro.
Sem isso, um binding de agente para modelo indisponível cairia para o nível de
baixo e pousaria num modelo chat-only, violando a
[RN-040](../business-rules/custo.md#rn-040) em silêncio — a falha só apareceria depois,
no ToolLoop, como "o agente parou sozinho". É exatamente o modo de falha que o
ADR 0020 custou nove execuções para diagnosticar.

O gatilho é o turno TER ferramentas, não o ator ser agente: um turno de resumo
do context-manager sem `tools` roda bem em modelo chat-only, e travá-lo
restringiria mais do que a regra pede.

### Preço: snapshot em `token_usage`, auditoria em tabela própria

`token_usage` ganhou `input_price_per_million_micros` e
`output_price_per_million_micros` — o preço que produziu aquele custo. É o que
torna o custo antigo reproduzível, e não apenas imutável
([RN-044](../business-rules/custo.md#rn-044)).

A alternativa considerada era uma **tabela de vigência** (preço com intervalo de
validade, custo recalculado por join). Foi descartada: obrigaria toda leitura de
custo a resolver o intervalo certo, e um bug nesse join reprecificaria o passado
inteiro — exatamente o que a fase proíbe. O snapshot põe a resposta na linha.

`model_price_changes` é append-only, com o par antes/depois. Fica em tabela
própria e **não no outbox**: `Engine.Outbox.Drain.run_once/0` filtra
`aggregate_type == "session"`, então uma linha de preço ali ficaria com
`processed_at` nulo para sempre e sujaria a métrica de lag da outbox. É log de
domínio imutável, como `session_events` — mesma regra do CLAUDE.md.

### O engine agenda, a api executa

O sync roda como worker Oban **auto-reagendado** (`ModelSyncSchedulerWorker`),
no idioma que o repositório já usa desde o `OutboxDrainWorker` —
`Oban.Plugins.Cron` não está instalado, e o `unique:` fica só no `kickoff/0`,
nunca no `use`, senão o job em execução colidiria consigo mesmo e mataria a
corrente depois de uma rodada.

O worker chama `POST /internal/models/sync` porque é a api que tem as
credenciais e o registry de providers; duplicar o registry no Elixir
significaria manter dois catálogos. O reagendamento acontece **antes** do
trabalho, de propósito: uma rodada ruim não pode matar a corrente periódica.

O botão "Atualizar catálogo" da UI chama o mesmo caso de uso por
`POST /workspaces/:id/models/sync` — não existem duas reconciliações que possam
divergir.

### A curadoria pende de um `:workspaceId`, e o catálogo é global

O `RolesGuard` resolve o papel efetivo a partir de `:projectId` ou
`:workspaceId` na rota. Sem um dos dois ele não tem de onde tirar papel nenhum,
e um `@RequireRole('owner')` numa rota sem escopo **reprovaria sempre**. Por
isso as rotas de curadoria são `/workspaces/:workspaceId/models/*`.

O catálogo em si continua global — a tabela `models` nunca foi por workspace. O
workspace no caminho é âncora de RBAC, não recorte de dados, e a consequência
está registrada abaixo como backlog.

## Consequências

- Um provider novo que exponha `GET /models` ganha sync sem escrever sync:
  declara `listModels: true` e, se o formato divergir, um `parseCatalogo`.
- A UI passou a ter uma tela de curadoria, com ativação em lote e o relatório do
  sync mostrando **todo** provider, inclusive o pulado.
- O `ModelPicker` foi reagrupado por origem (Local · APIs diretas · Hubs) e
  ganhou o filtro "aptos para agentes" — que a mensagem de erro da RN-040 citava
  desde a Fase 9a sem existir.
- O preço passou a ser mostrado com entrada e saída **separadas**. A média
  escondia a assimetria: um modelo de 3 USD de entrada e 15 de saída aparecia
  como "9", que não é o preço de nada.

## O que fica para depois

- **Os seis providers da Fase 9b** (NVIDIA NIM, Deep Infra, Together AI, Bitdeer
  AI, Vultr e OpenRouter). A política de egress do ambiente desta sessão nega
  todo HTTPS de saída, e o escopo da fase exige verificar `baseUrl`, auth,
  formato de `usage` e particularidades de streaming **na doc oficial** antes de
  codar. A base, o contrato, o sync e o metering por `upstream_provider` estão
  prontos para recebê-los: cada um é config + seed + kind de credencial.
- **O aceite com credencial real do OpenRouter** (catálogo de verdade e
  `upstream_provider` preenchido numa task), que depende do item acima.
- **`listModels` do Ollama e do Anthropic.** Os dois têm endpoint de catálogo,
  não verificado na doc nesta fase. Declaram `false` e são pulados
  explicitamente, que é honesto; declarar `true` com parsing adivinhado marcaria
  o catálogo inteiro como sumido.
- **Sync automático de preço ligado por default.** O sync grava preço só onde a
  linha não está marcada como `manual_pricing`; aplicar preço vindo de sync
  sobre linha manual exige decisão explícita do owner, e a UI dessa decisão não
  existe ainda.
- **Catálogo por workspace.** Hoje a curadoria é global e o `:workspaceId` da
  rota é só âncora de RBAC — um owner do workspace A ativando um modelo o ativa
  para o B.
- **Bedrock e Azure OpenAI**, fora do escopo da Fase 9 desde o enunciado.
- **`brabo_llm_call_errors_total`**, que o ADR 0041 registrou como praticamente
  inerte. Segue anotado, não corrigido de passagem.
