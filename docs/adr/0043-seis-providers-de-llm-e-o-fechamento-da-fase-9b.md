# 0043 — Seis providers de LLM sobre a base, e a Fase 9b finalmente fechada

## Contexto

O [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
entregou a base OpenAI-compatível, o contrato de providers e as
capabilities em duas camadas. O [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
entregou o catálogo vivo e o preço auditável, mas deixou explícito no
próprio "O que fica para depois": **os seis providers da Fase 9b**
(NVIDIA NIM, Deep Infra, Together AI, Bitdeer AI, Vultr e OpenRouter)
não entraram — a política de egress da sessão daquela fase negava todo
HTTPS de saída, e verificar `baseUrl`, auth e particularidades de
streaming **na doc oficial** antes de codar era condição do próprio
escopo, não um detalhe.

A Fase 11 entregou os seis, em duas levas. Primeiro o OpenRouter
sozinho (11a) — o único **hub** dos seis, escolhido primeiro
justamente para provar a base contra produção real antes de repetir o
molde cinco vezes. Depois os cinco diretos (11b) — NVIDIA NIM,
Together AI, DeepInfra, Bitdeer, Vultr — em série, cada um investigado
**do zero** contra a doc oficial da API dele. A regra que orientou as
duas levas, herdada do espírito do próprio ADR 0041 ("cada flag existe
porque um provider real diverge"): suposição de quirk NUNCA é herdada
entre providers. Um provider que parece com outro pode divergir
exatamente onde ninguém checou.

## Decisão

### A tabela de aceite, provider por provider

| provider | `listModels` | por quê | teste de conexão | quirks | origem dos modelos |
| --- | --- | --- | --- | --- | --- |
| **OpenRouter** (11a) | `true` | catálogo com pricing na própria linha (string decimal USD/token, convertida) | `GET /key`, endpoint dedicado | headers próprios (`HTTP-Referer`/`X-Title`); erro NO MEIO do stream (único hub); id de modelo prefixado pelo upstream | sync |
| **NVIDIA NIM** | `false` | `GET /v1/models` existe, sem preço em doc nenhuma verificada | `GET /v1/models`, status-only | tool calling é por MODELO, não por API; endpoint hospedado ≠ container auto-hospedado | seed |
| **Together AI** | `true` | catálogo com `pricing` achatado (número), unidade inferida por comparação de mercado — não documentada explicitamente | `GET /v1/models`, status-only | ids namespaced (404 sem prefixo); 429 com `error_type` | sync + seed |
| **DeepInfra** | `true` | catálogo **público, sem autenticação**, confirmado AO VIVO com preço real | nenhum — o catálogo público não distingue chave boa de ruim | catálogo mistura chat/imagem/áudio/vídeo (filtro por `tags`) | sync + seed |
| **Bitdeer** | `false` | nenhum shape de catálogo/preço encontrado publicamente | `GET /v1/models`, confirmado 401 ao vivo sem chave | doc pública mais rasa dos seis; 3 ids REAIS confirmados em exemplo de config do próprio blog | seed |
| **Vultr** | `false` | a rota que a base chama (`/models`) não tem preço na doc; a rota com preço documentada devolveu 404 ao vivo | `GET /v1/models`, confirmado 401 ao vivo sem chave | tool calling confirmado com exemplo real (`kimi-k2-instruct`, `finish_reason: "tool_calls"`) | seed |

### "Falso honesto" venceu "verdadeiro frágil" duas vezes, ao vivo

A regra do ADR 0041/0042 ("capability só é declarada quando provada")
não é só princípio — foi testada durante a implementação e mudou o
resultado duas vezes:

- **DeepInfra** entrou no planejamento como candidato a `listModels:
  false` (a doc sugeria autenticação obrigatória e pricing não
  confirmado no endpoint que a base chama). Uma checagem AO VIVO contra
  `GET https://api.deepinfra.com/v1/openai/models` (o mesmo endpoint
  que `OpenAICompatibleProvider.listModels()` sempre chama —
  `{baseUrl}/models`, sem exceção) revelou que o catálogo é público,
  sem autenticação nenhuma, e devolve preço real sob
  `metadata.pricing.{input_tokens,output_tokens}`. Virou `true` — sem
  precisar estender a base, porque a URL que ela já chama por padrão
  bastou.
- **Vultr** teve o caminho inverso: o planejamento apontava `true`
  (a doc da Vultr associa preço a um endpoint `GET /provider` com
  `cost`/`contextWindow`). Uma checagem AO VIVO nesse caminho devolveu
  **404** — a doc estava desatualizada ou o caminho documentado nunca
  existiu nessa forma. Como a base só chama `{baseUrl}/models`, e essa
  rota (confirmada existir, 401 sem chave) não tem preço segundo a
  própria referência oficial da Vultr, a decisão virou `false`.

Nos dois casos, a decisão final não veio do plano — veio de bater a
API de verdade durante a implementação. Um plano que travasse a
decisão antes dessa checagem teria acertado a NIM/Bitdeer e errado a
DeepInfra/Vultr.

### Nenhum "kind de credencial" novo

Todo credencial de LLM, dos nove providers, tem a MESMA forma —
uma chave de API cifrada por envelope encryption
(`user_credentials.encrypted_api_key`). Não existia, e continua não
existindo, uma distinção estrutural de "tipo" de credencial (OAuth vs.
chave, por exemplo) do lado LLM. O que varia por provider é só **se**
ele tem um teste de conexão declarado (`GET /key` dedicado pro
OpenRouter; `GET {baseUrl}/models` status-only pros cinco diretos que
o suportam; nenhum pra DeepInfra, cujo catálogo público não serve pra
validar chave nenhuma).

## Consequências

- `LLM_PROVIDER_NAMES` foi de 3 para **9** entradas (`llmProviderEnum`
  e `credentialProviderEnum` acompanham, via migração `0030`). A
  checagem de exaustividade bidirecional que o ADR 0041 já garantia
  (tipo × array) segurou o build vermelho até o registry e o módulo
  ganharem os 9 casos — funcionou exatamente como desenhado.
- O DTO de cadastro de credencial
  (`upsert-credential.dto.ts`) e o testador de conexão
  (`llm-credential-connection-tester.ts`) deixaram de ter uma lista de
  providers hardcoded (triplicada no DTO — Swagger, `@IsIn`, tipo TS) e
  passaram a derivar de `LLM_PROVIDER_NAMES_COM_CREDENCIAL`/um mapa de
  overrides. Achado real desta fase: a lista manual foi exatamente o
  que quebrou um teste no meio do trabalho, quando o construtor do
  testador de credencial ganhou um parâmetro a mais e um spec não
  acompanhou — o mesmo tipo de falha silenciosa que a checagem de
  exaustividade do ADR 0041 já existia pra evitar do lado do tipo, só
  que aqui era do lado do valor.
- Tela de credenciais e `ModelPicker` absorveram os 9 sem componente
  novo: `ROTULO_DO_PROVIDER` (um `Record` exaustivo) ganhou 6 rótulos,
  `HUBS` continua com um membro só (`openrouter`) — os cinco diretos
  caem em "APIs diretas" por não estarem nessa lista, não por uma
  regra nova.
- A referência gerada (`docs/reference/llm-providers.md`, bloco
  `providers-capabilities`) ganhou três colunas — credencial, origem
  dos modelos (`sync` | `seed` | `sync + seed`) e quirks resumidos —
  todas DERIVADAS mecanicamente (do código e da prosa já escrita à
  mão), sem tocar nenhum arquivo de provider só pra alimentar doc.

### Nota de insight: o gancho pro roteamento de custo do Psicólogo

`upstream_provider` (ADR 0042, preparo da Fase 9b) agora tem dado real
por trás — não só schema vazio. A query de exemplo em
`docs/reference/llm-providers.md` ("Hubs e o custo real") mostra que
comparar custo do MESMO modelo, hub × direto, já é consultável hoje.
**Isto é registrado como semente, não implementado**: não existe
consumidor automático dessa comparação, e a leitura natural — o
Psicólogo um dia sugerir "este modelo sai mais barato direto que via
hub" — fica só anotada aqui, sem ticket nem escopo de fase.

### Verificação de que a base saiu intocada

`git diff origin/main -- apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
é **vazio** — `SyncModelCatalogUseCase` já iterava `LLM_PROVIDER_NAMES`
genericamente desde o ADR 0042; absorver 6 providers a mais não pediu
uma linha.

`git diff origin/main -- apps/api/src/infrastructure/llm/openai-compatible-provider.ts`
**não é vazio**: +31/-0, um único hook —

```ts
export type ParseErrorFrame = (
  frame: Record<string, unknown>,
) => LLMProviderError | undefined;
```

mais o campo opcional `parseErrorFrame?: ParseErrorFrame` na
`OpenAICompatibleConfig`, e a chamada dele NO MEIO do loop de SSE,
antes de ler `delta`/`usage` — porque um frame de erro de hub não é um
frame de conteúdo com campos vazios, é outra coisa, e tratá-lo como o
segundo esconderia a falha em vez de reportá-la. As 31 linhas existem
exclusivamente porque o **OpenRouter é o único hub dos seis**: só um
hub aceita a conexão, começa a mandar texto, e tem o provedor real por
trás caindo NO MEIO do stream — nenhum provider direto tem essa classe
de falha, porque nenhum roteia pra infraestrutura de terceiros. Prova
de que a extensão era mínima e necessária, não especulativa: os cinco
providers diretos da 11b passaram pela suite de contrato inteira sem
declarar `parseErrorFrame` nenhum, e nenhum precisou.

Nenhum outro arquivo da base (`http-stream.ts`,
`llm-provider-errors.ts`, `model-capabilities.ts`,
`model.repository.ts`) tem diff nenhum contra `origin/main`.

## O que fica para depois

- **O aceite com credencial real dos seis smokes**
  (`openrouter-provider.smoke.spec.ts` e os cinco da 11b), cada um
  gated pela própria `<PROVIDER>_TEST_KEY`. Escritos, testados contra
  o mock, nunca rodados contra chave de verdade — mesma pendência que
  o ADR 0042 já registrava pro OpenRouter, agora estendida aos cinco
  novos. Rodar cada um (quando houver chave) é o que finalmente prova
  o preço da Together/DeepInfra e os IDs estimados da NIM/Bitdeer/Vultr
  contra a realidade, não contra a doc.
- **Preço estimado de NVIDIA NIM, Bitdeer e Vultr** — nenhum dos três
  publica preço por modelo em doc acessível nesta fase; os valores
  semeados são aproximação de mercado (`manual_pricing: true`),
  corrigíveis assim que houver fonte oficial.
- **A leitura de roteamento de custo do Psicólogo** (ver a nota de
  insight acima) — semente, não escopo de fase nenhuma ainda.
- **Os achados P1 do dogfooding** (Fase 10) continuam intocados,
  disputando a Fase 12 com o resto do backlog — Fase 11 nunca teve
  autorização pra tocá-los, e não tocou.

Referencia [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)
e [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md),
cuja fundação sustentou os seis providers como config — nenhum deles
precisou de refatoração na base além do único hook que o OpenRouter,
sendo hub, provou necessário.
