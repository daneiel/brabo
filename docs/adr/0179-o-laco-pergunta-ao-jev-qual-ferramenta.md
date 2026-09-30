# 0179 — O laço pergunta ao Jev qual ferramenta, e o modelo do usuário vê só o menu que sobra

## Status

**Accepted.** 2026-09-29 (AT-238, história HS-063, épico EP-029). Implementa a
especificação da AT-235 com as dezesseis decisões do mantenedor da AT-236
(2026-09-28) e a decisão de 2026-09-29 sobre o critério de adoção, abaixo. Não
substitui nenhum ADR: acrescenta uma peça **fora** do contrato de provider do
[ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) e do catálogo de modelos do
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md), e reusa o metering, o
orçamento (ADR 0110) e a credencial do titular (RN-058) sem mudá-los.

## Context

Hoje quem escolhe a ferramenta de cada passo de um agente é o **modelo de chat
do usuário**, olhando um catálogo de 7 a 19 definições a cada chamada. As
medições de 2026-09-27 a 29 (`docs/explanation/medicao-do-jev.md`) puseram o Jev
— o modelo `typesafe/jev-1.13` do Decisions API do OpenRouter, que responde uma
pergunta de múltipla escolha com probabilidades — contra 328 passos reais já
gravados:

- **top-1 do Jev: 73% (66–79%)**, abaixo dos 90% que a AT-237 pedia para o Jev
  ESCOLHER sozinho. Escolher e forçar não serve.
- **cobertura de menu da política P3: 91% (85,1–94%)** — a fração dos passos em
  que a ferramenta que o agente de fato chamou está DENTRO do menu
  {escolha do Jev, ferramenta anterior da mesma execução}. O top-2 do Jev cobre
  90%. Cobertura é o TETO da acurácia ponta a ponta (a do modelo de chat, agora
  sobre 1,6 ferramentas em vez de 7,4), não a acurácia.
- P3 oferece UMA só ferramenta em 98 dos 160 passos de validação, e as
  definições que o modelo lê por chamada caem de 746 para 138 tokens.

O Jev, portanto, serve para **restringir** o menu, não para decidir por ele — e
isso é o que a AT-236 já tinha decidido (resposta 12: o Jev só restringe).

### A decisão do mantenedor sobre o critério (2026-09-29)

O critério de adoção da AT-237 era um limite inferior do intervalo de confiança
de **90%**. Nenhuma política o alcançou (P3: 85,1%). Em 2026-09-29 o mantenedor
**baixou o critério para 80%**, com os números acima diante dele, e mandou
implementar a P3. Isto é decisão do dono, não achado: o limite inferior de P3
(85,1%) passa de 80%, e nenhum outro texto deste repositório deve dizer que a
adoção "passou nos 90%". O que a medição NÃO prova continua declarado:

- cobertura é teto, e a acurácia ponta a ponta medida em replay ficou entre
  62% e 91% conforme a hipótese sobre o modelo de chat;
- o intervalo de Wilson trata 160 passos como independentes e eles são 10
  execuções — o intervalo honesto é mais largo;
- **a validação real é a AT-239**, ao vivo, comparando passos, latência e custo
  do turno com e sem o Jev. Este ADR entrega o mecanismo, ligado por padrão
  como a AT-236 mandou, com o desligador por workspace à mão.

## Decision

**1. O roteador mora na api, dentro do `llm-turn`, atrás de uma porta própria.**
`ToolRouter` (`apps/api/src/application/ports/tool-router.port.ts`) não é um
`LLMProvider` e não está no `LLMProviderRegistry`: o Jev decide, não conversa,
não passa pela suíte de contrato de provider e **não entra no catálogo
`models`**. O adaptador (`JevToolRouter`) fala com
`POST https://openrouter.ai/api/alpha/decisions`, com o formato MEDIDO em
`scripts/jev/jev.ts` — `questions` é um **objeto** chaveado pelo id da pergunta
(a nota da AT-235 escrevia uma lista, e a API respondeu 400). Um caso de uso
único, `DecidirFerramentaDoPassoUseCase`, é chamado pelos DOIS casos de uso de
turno (`RunLlmTurnUseCase` e `StreamLlmTurnUseCase`) depois de o provider
resolvido e o gate de orçamento passarem e antes do `provider.chat`. Sete
agentes conversacionais, o `ToolLoop` dos dev agents e dos gates, e o Infra Lead
passam todos por eles (AT-236 resposta 2); só a Anamnese (pausada) e o
sumarizador da compactação ficam de fora.

**2. Quando ele é consultado — todas as condições, e só então há chamada:**
provider do modelo do turno é `openrouter` (AT-236 resposta 1, leitura (a));
o pedido traz duas ou mais ferramentas; há agente no turno; o engine não pediu
o catálogo inteiro; o workspace não desligou. A chave do Jev é a MESMA já
decifrada para o chat — a do titular do workspace (RN-058) — e nenhuma leitura
de credencial nova nasce. Com provider ≠ `openrouter` nenhuma chamada sai, nem a
leitura do workspace.

**3. A política é a P3, e é só restringir.** O menu do passo é
{ferramenta escolhida pelo Jev, ferramenta anterior da mesma execução}, na ordem
do catálogo. Se o Jev responder `responder_sem_ferramenta`, ou não houver
ferramenta anterior no catálogo do passo, o menu é o **catálogo inteiro**
(AT-236 resposta 12: "catálogo inteiro, só registra"). Não há `tool_choice`: só
se restringe o cardápio, o modelo ainda pode responder em texto (resposta 7).
**Não há limiar de confiança na v1** — a P3 medida não usa um, a AT-236 resposta
4 mandava tirá-lo da medição e a medição da P3 não o produz. A confiança é
GRAVADA em todo passo, e é da AT-239 propor um limiar (por agente, se as curvas
diferirem).

**4. O `state` é o que o produto realmente tem antes do passo** — os campos da
variante `escopo`, a vencedora da segunda rodada, recortados dentro da api das
`messages` que o engine já manda, sem leitura de banco: `agente` (o `agentId`),
`contexto` (o começo da primeira mensagem `system`, 1.500 caracteres), `pedido`
(a última mensagem `user`) e `passos_recentes` (as 6 últimas chamadas de
ferramenta DEPOIS dessa mensagem, argumento e resultado cortados em 500). Teto
de 8 mil tokens por pedido, um quarto da janela do Jev; estourou, queda
`estado_grande`. Duas diferenças para o medido, declaradas: `contexto` é o
começo do `system` de verdade, e não "identidade do ator + instrução" como no
replay; e num dev agent em correção o `pedido` é a mensagem de correção, a
última `user`, não o kickoff.

**5. O turno NUNCA falha por causa do Jev.** Erro HTTP (inclui o 404/410 de um
endpoint alpha que mudou), timeout (teto de 2.000 ms, `TOOL_ROUTER_TIMEOUT_MS`;
0 de 328 pedidos passaram dele na medição), erro de rede, JSON inesperado,
escolha fora das opções, estado grande, colisão de nome com a opção reservada:
o provider recebe o catálogo inteiro e o motivo vai ao evento com a **origem**
da RN-059 (`infra` para os três primeiros, `modelo` para os dois de forma,
`codigo` para os nossos). O adaptador nunca lança, e o caso de uso ainda
protege a si mesmo com um `try/catch` de última instância.

**6. A política não muda.** O Jev não aprova, não nega e não escolhe modelo. A
ferramenta que sobrar no menu segue virando `Proposed Action` e passando por
`decide()` e pelos tetos absolutos como sempre; o roteador nem importa esses
módulos, e um teste do engine afirma que o módulo dele não os conhece. Se o
modelo chamar uma ferramenta que NÃO estava no cardápio do passo (lembrada do
histórico), o engine a despacha como hoje e o evento só registra
`foraDoCardapio` (AT-236 resposta 13: o Jev estreita, não proíbe). O teto de
iteração fica intacto: a chamada ao Jev está DENTRO do mesmo `llm-turn`, e o laço
só incrementa depois do despacho.

**7. Registro por passo, para a AT-239 medir.** O engine grava
`tool_router.decided` na fachada `EngineApiClient` (um lugar só, para os sete
servidores e o `ToolLoop`) com menu antes e depois, escolha, confiança, segunda
opção, ferramenta anterior, `aplicado`, `motivoDaQueda`, `origemDaQueda`,
latência, custo e `foraDoCardapio`. Métrica sai por script sobre o log e sobre
`token_usage`, nunca anotada. A api devolve o passo no campo novo e opcional
`toolRouting` do `llm-turn` e do frame `final` do stream; engine antigo o ignora.

**8. O gasto do Jev é gasto de verdade.** Uma linha de `token_usage` pelo mesmo
`RecordLlmUsageUseCase` (o único caminho de metering, com orçamento de projeto,
sessão e ÁREA): `actor` é o **próprio agente** (resposta 10 — com ator próprio o
gasto escaparia do orçamento de área do ADR 0110), `provider = openrouter`,
`modelId = null`, `modelName = typesafe/jev-1.13` (é por ele que a aba Gastos
separa o Jev do chat, resposta 8), `estimated = false` e `costMicros` =
`usage.cost` da RESPOSTA, em micro-USD. O preço por milhão é **implícito**
(`custo ÷ tokens` da própria resposta, resposta 11) e a linha diz isso na coluna
nova `price_implicit`, mantendo `tokens × preço = custo` (RN-044) sem fingir que
existe preço de catálogo. O gate de orçamento **não** é reconsultado entre o Jev
e o chat (resposta 15). O custo do Jev volta ao engine em
`toolRouting.custoMicros`, e o `ToolLoop` o soma ao orçamento local dele sem
mexer em `usage`. O metering do Brabo para o CHAT registra menos do que o
OpenRouter cobra (preço de catálogo, sem cache nem raciocínio); o do Jev não
sofre disso, porque usa o custo que a resposta devolve.

**9. O desligador é do WORKSPACE** (resposta 3), coluna
`workspaces.tool_router_enabled`, padrão ligado, migration 0064, alterada por
`PUT workspaces/:workspaceId/tool-router` (`owner`, o dono da chave que paga).
A api lê a flag do próprio banco no caminho do turno; o engine não lê nada e não
faz HTTP a mais. Desligado, nenhuma chamada ao Jev sai e nenhum evento nasce. A
variável de instalação `TOOL_ROUTER=jev|off` que a AT-235 propunha NÃO nasceu: a
decisão do mantenedor foi por workspace. Nasceu só `TOOL_ROUTER_TIMEOUT_MS`.

**10. O caminho para o agente pedir o catálogo completo** — a AT-281 mostrou que
61% dos passos teriam menu de UMA ferramenta, e um menu errado não pode virar um
beco. O mecanismo é o mais simples que não abre porta nova de contenção: se o
menu foi restringido (`aplicado`) e o modelo respondeu **sem chamar ferramenta**
(nem em texto recuperável pela ADR 0020) e sem erro do provider, a fachada
repete o passo **uma vez** com `catalogoCompleto: true`, que faz a api pular o
Jev. A repetição pede MAIS ferramentas, nunca uma que o agente não tinha; a
api não confia em nada do engine além de "não me restrinja"; o cardápio nunca
foi fronteira de segurança. No stream dos conversacionais só se repete se NADA
foi escrito para a pessoa (um delta entregue não se desfaz). O custo da
repetição são as duas chamadas de chat, ambas metered; o `toolRouting` da
primeira fica marcado `repetidoComCatalogoInteiro`. Foi descartado: um
`request_full_toolset` como ferramenta nova (é superfície nova de ferramenta em
todo agente, e o modelo com menu de uma ferramenta não tem por que chamá-la) e
`report_blocked` como sinal (ele encerra o laço).

## Consequences

- Cada passo elegível ganha uma chamada em série (Jev, depois chat): +~0,2–0,4
  s de latência (as linhas gravadas da medição) e ~US$ 0,00005 por passo. O ganho — menos
  definições por chamada, e talvez menos passos — é hipótese, e a AT-239 o mede.
- Quando o Jev erra e o menu deixa o modelo sem a ferramenta certa, o custo é
  uma volta a mais (item 10). A taxa dessa repetição está no evento
  (`repetidoComCatalogoInteiro`) e é a métrica de que o menu está ruim.
- O endpoint é ALPHA. Se mudar, o smoke manual
  (`jev-tool-router.smoke.spec.ts`, teto US$ 0,05, pulado sem `OPENROUTER_TEST_KEY`)
  reprova e, em produção, todo passo cai no catálogo inteiro com `erro_http` ou
  `resposta_invalida` no evento — o desligador por workspace existe para o caso
  de a queda ser barulhenta demais.
- Um timeout do lado do Brabo pode ter sido cobrado pelo OpenRouter sem que
  vejamos o `usage.cost`: esse gasto não entra em `token_usage`. Declarado, não
  medido.
- A chave é única por instalação de workspace, não por agente nem por projeto.

## O que este ADR NÃO faz

- **Não mede o ganho** (AT-239) nem calibra limiar; não há limiar na v1.
- **Não mostra nada na tela.** A AT-236 (resposta 3) quer que a tela mostre que
  o passo foi roteado pelo Jev, com a confiança, e (resposta 16) que a faixa
  narre "escolhendo ferramenta". O dado existe (o evento e o frame
  `tool_routing_started` do stream, que o engine ignora por ser de tipo
  desconhecido); a tela e a faixa são trabalho de `apps/web`, fora desta lane.
- Não muda os servidores de agente além do que a fachada já cobre, não roteia a
  Anamnese e não põe o Jev no catálogo de modelos.
- Não decide sobre subir o teto de 2.000 ms nem sobre o ecossistema Dependabot
  para o pin `typesafe/jev-1.13` (bump por PR, resposta 5).
