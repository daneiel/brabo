---
id: medicao-do-idioma
title: Medição da heurística de idioma
description: O instrumento que mede a heurística de detecção de idioma da AT-080 contra um corpus rotulado, os números que ele produziu no corpus sintético, e a validação paga da orientação de idioma e do custo dela (AT-167, 2026-09-29).
---

# Medição da heurística de idioma {#measuring-the-language-heuristic}

> AT-160 (EP-028, HS-053). A heurística medida é a que a especificação da
> AT-080 propôs ("A — heurística própria, sem dependência"). Desde a AT-163
> ([RN-624](../business-rules.md#rn-624)) o produto a roda: a api detecta
> o idioma do autor com ela e PERGUNTA antes de qualquer coisa mudar. Os
> limiares do produto são **provisórios** — veja
> [Os limiares provisórios do produto](#the-products-provisional-thresholds).

## O que existe {#what-exists}

O instrumento mora em `scripts/idioma/` e roda com o Node do repositório
(type stripping, sem passo de build). **Nenhuma dependência nova**: a heurística
é lista de marcadores e expressões regulares, e a extração fala com o Postgres
por `psql` dentro do container do banco.

A heurística em si mora na **api** —
`apps/api/src/domain/iam/heuristica-de-idioma.ts` — e `scripts/idioma/heuristica.ts`
só a reexporta, então o instrumento mede exatamente o código que o produto
roda. Essa direção é forçada: a api não alcança nem `scripts/` nem pacote de
runtime nenhum sem passo de build, e `packages/shared` é só tipos. O arquivo
não tem imports, então o Node o roda a partir de `scripts/` por type stripping
(os comandos `idioma:*` silenciam o aviso de "typeless package" que vem junto),
e `scripts/idioma/` tem `tsconfig.json` próprio — a única diferença é desligar
`verbatimModuleSyntax`, que recusa todo `export` de módulo CommonJS como os da
api. Um arquivo `.mts` foi tentado primeiro: passou nos dois typechecks e no
build, e quebrou todo script `ts-node` da api. A regra do *que é evidência*
(`evidenciasDoAutor`) se mudou junto com a heurística, e a extração do corpus
real usa a mesma.

| arquivo | papel |
|---|---|
| `heuristica.ts` | reexporta a heurística da api: limpeza, pontuação contrastiva, o candidato e os parâmetros provisórios, a amostra de 10 mensagens, a histerese e a regra de evidência |
| `corpus-sintetico.jsonl` | o corpus sintético **versionado** — toda linha escrita à mão para o instrumento, `origem: "sintetico"` |
| `sequencias-sinteticas.json` | conversas sintéticas para o caminho da amostra e da histerese |
| `medicao.ts` / `medir.ts` | o instrumento e o CLI dele |
| `extrair.ts` | extrai o corpus **real** do event log local, para um arquivo fora do git |
| `rotular.ts` | rotulação assistida do corpus real, no terminal |

## Os dois corpora, e onde cada um mora {#the-two-corpora-and-where-each-one-lives}

A decisão do mantenedor (AT-168, resposta 5) é **real + sintético**. Eles têm
regras de armazenamento opostas:

- **Sintético** — versionado, revisado como código. Cobre os nove casos
  obrigatórios da AT-080 (erros de digitação, espanhol legítimo, inglês, texto
  misto, "ok", código, logs, citações em outro idioma) mais português cheio de
  jargão em inglês, identificadores inline, e idiomas fora dos três (francês,
  italiano, alemão, galego, catalão, holandês) — a lista de idiomas é aberta
  (AT-168, resposta 2).
- **Real** — as mensagens do próprio usuário no event log **local**. Nunca
  entra no git, numa fixture, num log de CI nem no corpo de uma PR. `extrair.ts`
  e `corpus.ts` recusam qualquer destino dentro do checkout, e o arquivo é
  gravado com modo 600 em `$XDG_CACHE_HOME/brabo/corpus-idioma/` (senão
  `~/.cache/…`). O relatório nunca imprime o texto de um item — só ids, rótulos
  e contagens —, então a saída dele pode ser colada numa PR.

O que a extração toma como evidência segue a limpeza da AT-080: só eventos
cujo ator é o **usuário** (a resposta do agente nunca é evidência, então uma
resposta em espanhol do modelo não pode realimentar a detecção) e, no
formulário estruturado, só as **respostas** — o `chat.message` concatenado que
a api grava logo depois, cujos rótulos são texto do agente, é pulado.

O assistente de rotulação **não** pré-preenche o palpite da heurística:
aceitá-lo com ENTER ancoraria o rótulo justamente na coisa que o rótulo existe
para medir. ENTER aceita o idioma que o dono declara com `--padrao`.

Rótulos: um código BCP-47 (`pt-BR`, `es`, `fr`…), `und` (nada a decidir: "ok",
só código, só um log) ou `mul` (misto, sem idioma dominante). Pontuação:
`pt`/`es`/`en` têm de receber o próprio idioma; `und`, `mul` e qualquer outro
idioma têm de receber `indeterminado` — a única resposta correta que uma
heurística de três idiomas pode dar a eles. Um `indeterminado` num item
decidível é **cobertura perdida** (a preferência conhecida fica); um idioma
errado é **erro**, e `falso es` é contado à parte porque é o defeito que o
épico existe para remover.

## Como rodar {#running-it}

```bash
# synthetic corpus (the default)
pnpm --filter @brabo/scripts idioma:medir

# the owner's real corpus, on the owner's machine
pnpm --filter @brabo/scripts idioma:extrair --container brabo-dev-postgres-1
pnpm --filter @brabo/scripts idioma:rotular --padrao pt-BR
pnpm --filter @brabo/scripts idioma:medir --real
```

`--container` roda `psql` dentro desse container com um único `SELECT` só de
leitura em `session_events` (`--usuario`/`--banco` têm como default o
`brabo`/`brabo` do compose); `--database-url <url>` usa um `psql` do host no
lugar. Rodar a extração de novo mantém os rótulos existentes e acrescenta as
mensagens novas sem rótulo.

## Números no corpus sintético (2026-09-28) {#numbers-on-the-synthetic-corpus-2026-09-28}

123 itens rotulados, 7 sequências, parâmetros candidatos da AT-080 (mínimo de
20 palavras, limiar 0,8, margem 0,3, 10 mensagens / 2.000 caracteres, histerese
2). Duas listas de marcadores: `at080` é a lista da especificação, literal;
`ampliada` é uma lista maior escrita por este instrumento **antes** de ele rodar
contra o corpus (palavras funcionais frequentes ausentes dos outros dois
idiomas). Mesmo corpus, então `ampliada` não é validada por estes números — quem
pode dizer é o corpus real.

Por mensagem, parâmetros candidatos:

| rótulo | n | `at080` correto | `at080` indeterminado | `ampliada` correto | `ampliada` indeterminado |
|---|---|---|---|---|---|
| pt | 56 | 26 (46,4%) | 30 | 30 (53,6%) | 26 |
| es | 20 | 6 (30,0%) | 14 | 7 (35,0%) | 13 |
| en | 14 | 6 (42,9%) | 8 | 6 (42,9%) | 8 |
| und | 15 | 15 (100%) | 0 | 15 (100%) | 0 |
| mul | 5 | 5 (100%) | 0 | 5 (100%) | 0 |
| outros idiomas | 13 | 10 | 0 | 9 | 0 |

Vereditos de idioma errado: **nenhum num item `pt`/`es`/`en`**, em nenhuma das
listas. Todos estão em idiomas fora dos três — `at080`: francês → pt (o `ê` de
*arrêté*), **galego → es** (o único `falso es`), holandês → en; `ampliada`:
francês → es, alemão → pt e → en, holandês → en.

A limpeza removeu mais da metade das palavras de **zero** itens decidíveis.

As sete sequências sintéticas terminam onde se espera com no máximo o número
permitido de trocas, nas duas listas — inclusive português com uma citação
longa em espanhol, uma mensagem inteira em espanhol no meio do português, e
português denso de jargão em inglês.

CPU nesta máquina: `at080` 11,7 µs por mensagem e 49 µs por avaliação da
amostra de 10 mensagens; `ampliada` 16,8 µs e 60 µs. Varia com a máquina; o que
importa é a ordem de grandeza.

## O que os números dizem {#what-the-numbers-say}

- **Com a lista `at080`, o limiar e a margem nunca atuam.** 66 dos 67 itens que
  pontuam alguma coisa pontuam para um idioma só (confiança = 1,0), então
  varrer o limiar de 0,5 a 1,0 não muda nada. O mínimo de palavras é o único
  botão que age: por mensagem, os itens decidíveis chegam ao idioma deles 42,2%
  das vezes com 20 palavras, 58,9% com 10 e 66,7% sem mínimo — com 20 ele joga
  fora toda mensagem curta e com erro de digitação e a maior parte das técnicas.
- **Tirar o mínimo deixa texto misto decidir.** Sem mínimo, `at080` transforma
  três das cinco mensagens mistas em `en` ou `pt`, e `ampliada` também decide
  dois itens `und` como `en` — código sem cerca (`const total = itens.reduce(…)`)
  e saída do pnpm (`ELIFECYCLE  Test failed. See above for more details.`) passam
  pela limpeza, que só conhece código cercado e os formatos de log que a AT-080
  listou.
- **A margem de 0,3 é redundante com o limiar de 0,8** em qualquer lista: com
  três idiomas, um vencedor com ≥ 0,8 fica pelo menos 0,6 acima do segundo.
- **A unidade que importa é a amostra, não a mensagem** — nas sequências, a
  janela de 10 mensagens chega ao idioma com mensagens que sozinhas seriam
  `indeterminado`. Uma única mensagem em espanhol numa janela em português torna
  a amostra `indeterminado` enquanto ela estiver na janela (sequência `q03`):
  nenhuma troca, mas nenhuma confirmação também.
- **A lista aberta de idiomas é onde estão os erros.** Com três idiomas, um
  usuário galego ou francês pode ouvir que escreve espanhol ou português. Pela
  regra da AT-168 a detecção só *pergunta*, e o usuário confirma, então o custo
  é uma pergunta errada — mas continua sendo o único modo de falha da heurística
  aqui.

Estes são números sintéticos: o corpus foi escrito pela mesma mão que escreveu
a heurística. Os limiares da AT-163 deveriam vir do corpus real.

## Os limiares provisórios do produto {#the-products-provisional-thresholds}

A AT-163 tinha de sair com *algum* número antes de o corpus real existir, então
a api lê `PARAMETROS_PROVISORIOS` — **provisórios, não calibrados**, e assim
declarados na [RN-624](../business-rules.md#rn-624):

| parâmetro | provisório | candidato da AT-080 | por quê |
|---|---|---|---|
| lista de marcadores | `at080` | — | `ampliada` ganha 4 pontos em pt e erra o alemão duas vezes; nenhuma das duas é validada por dado real |
| mínimo de palavras (sobre a amostra) | **10** | 20 | cobertura dos itens decidíveis 42,2% → 58,9% com os **mesmos** três vereditos errados (francês, galego, holandês — idiomas fora dos três); abaixo de 10, texto misto começa a decidir |
| limiar / margem | 0,8 / 0,3 | 0,8 / 0,3 | nunca atuam no corpus sintético, então ainda não há número melhor para escolher |
| amostra | 10 mensagens / 2.000 caracteres | igual | — |
| histerese | 2 | 2 | — |

A histerese é **recalculada, nunca guardada**: a api lê as últimas 11
evidências e pergunta se as duas últimas avaliações da amostra concordam. CPU
nesta máquina, corpus sintético: 11,6 µs para limpar e classificar uma
mensagem, 110 µs por detecção (11 mensagens, duas avaliações). A leitura é
servida por um índice parcial em `session_events`: 0,056 ms contra 13,5 ms de
uma varredura sequencial, medidos sobre 200.000 eventos.

Para recalibrar: rode o corpus real (`idioma:medir --real`) e depois mude
`PARAMETROS_PROVISORIOS` na api — é o único lugar de onde o produto os lê, e o
instrumento importa o mesmo arquivo (o relatório dele continua varrendo os
candidatos da AT-080).

## Validação paga da orientação de idioma (AT-167, 2026-09-29) {#paid-validation-of-the-language-orientation-at-167-2026-09-29}

> O protocolo é o da AT-082, com as decisões da AT-169: orçamento de US$ 5,
> 5 rodadas por caso e braço, limiar de aceite "no braço tratado, **zero**
> respostas em espanhol onde se espera pt-BR, e idioma correto **≥ 95%** em
> C01–C04 e C06–C15", modelo sob teste `deepseek/deepseek-v4.1-flash`, modelo
> de comparação `anthropic/claude-haiku-4.5`, teto de custo incremental de
> 50 tokens de entrada por chamada. Código em `d48f99f8e` (a `dev` de 2026-09-29).

### Onde roda, e o que é (e o que não é) o produto {#where-it-runs-and-what-is-and-is-not-the-product}

Um script fora do produto, `scripts/idioma/validar.ts` (a parte pura — matriz,
julgamento, relatório — em `validacao.ts`, testada por `validacao.spec.ts`). Ele
chama o OpenRouter **direto** e não grava nada no banco. O que o produto manda
ao modelo é **lido dos arquivos do produto a cada execução**, nunca copiado — a
leitura lança, nomeando o que não achou, se um arquivo mudar de forma:

- a orientação (RN-622/623): `@textos`, a frase genérica, a cláusula de
  artefato, `@forma_curta` e `@ferramentas_de_artefato` de
  `apps/engine/lib/engine/harness/idioma_da_resposta.ex`, enviada como a ÚLTIMA
  mensagem, `role: "system"`, em toda chamada de um turno tratado (iterações de
  ferramenta incluídas) e nunca mantida no histórico;
- o prompt de resumo e a frase de idioma dele (RN-621) de
  `apps/engine/lib/engine/harness/context_manager.ex`;
- a persona do Criativo (`CRIATIVO_INSTRUCTIONS`), as duas ferramentas dele com
  as descrições reais, e os resultados de ferramenta que o produto devolve.

Diferenças declaradas em relação ao produto: o system prompt é só a persona
(sem as camadas do `ContextBuilder`); a compactação é **forçada** antes do
quinto turno do C04 (mantendo as duas últimas mensagens, o `keep_recent` do
produto), com o modelo sob teste como resumidor; a retomada (C15) é o histórico
reconstruído como texto, a forma de `Engine.Agents.Reidratacao`; no máximo 4
chamadas ao modelo por turno (o Criativo permite 12); e `max_tokens` tem teto
de 4000 (o produto não manda nenhum). O provider upstream **não** foi fixado —
registrado por chamada como confundidor. Baseline = o código antes da
RN-621/622: sem orientação **e** com o prompt de resumo antigo (AT-169 resposta
4: a validação mede o conjunto, não há baseline isolado do resumo antigo).

O idioma resolvido do autor de cada mensagem faz parte do caso: `pt-BR` para a
Ana (C01–C05, C07–C11, C13–C15), `en` para o Bob (C06 como `en` detectado e
confirmado, C12 como preferência `en` explícita escrevendo português); idioma
do projeto `pt-BR`. O C05 espera **pt-BR**: pela resposta 4 da AT-168 a
detecção só *pergunta*, então o idioma resolvido do autor continua pt-BR até a
confirmação.

Uma primeira execução do passo zero com `max_tokens` 1000 foi **descartada**: o
raciocínio do DeepSeek gastou o teto inteiro em 7 chamadas e a resposta voltou
vazia (dois resumos viraram o texto de fallback do produto). Os registros dela
ficam à parte na pasta de saída; resposta vazia agora conta como `falha`, nunca
`indeterminado`.

### Passo zero: não reproduzido {#step-zero-not-reproduced}

Só baseline, `deepseek/deepseek-v4.1-flash`, C01–C04, 5 rodadas: **0 respostas
em espanhol em 35 respostas julgadas** (35 pt, 0 indeterminadas). O relato de
13/09 (espanhol a partir de entrada em português) **não é reproduzido**, então
nenhuma melhora *naquele* defeito pode ser atribuída ao tratamento. A execução
continuou porque o limiar da AT-169 é absoluto no braço tratado e os outros
casos (C05, C06, C12, C16, C17) mostram, sim, o baseline respondendo no idioma
errado.

### Resultados por caso × braço × modelo {#results-by-case--arm--model}

Primeiro juiz: o classificador local (lista `ampliada`, parâmetros candidatos)
sobre a prosa. "ok" = idioma esperado; "errado (es)" = outro idioma (dos quais
espanhol); "ind." = indeterminado. n é o número de respostas julgadas (5 rodadas
× turnos julgados).

| caso | DeepSeek baseline | DeepSeek tratamento | Haiku baseline | Haiku tratamento |
|---|---|---|---|---|
| C01 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C02 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C03 (n=15) | 15 ok | 15 ok | 15 ok | 15 ok |
| C04 (n=10) | 10 ok | 10 ok | 10 ok | 10 ok |
| C05 (n=5, fora da lista dos 95%) | 1 ok, 4 errados (4 es) | 5 ok | 0 ok, 5 errados (5 es) | 2 ok, 3 errados (3 es) |
| C06 (n=5) | 2 ok, 2 errados, 1 ind. | 3 ok, 2 ind. | 4 ok, 1 errado | 5 ok |
| C07–C10 (n=5 cada) | todos ok | todos ok | todos ok | todos ok |
| C11 (n=10) | 6 ok, 4 errados | 5 ok, 5 errados | 5 ok, 1 errado, 4 ind. | 6 ok, 4 errados |
| C12 (n=10) | 0 ok, 10 errados | 4 ok, 6 ind. | 0 ok, 10 errados | **0 ok, 10 errados** |
| C13 (n=5) | 5 ok | 5 ok | 5 ok | 5 ok |
| C14, C15 (n=5 cada) | todos ok | todos ok | todos ok | todos ok |
| C16 (n=20, fora da lista) | 10 ok, 10 errados | 19 ok, 1 ind. | 10 ok, 10 errados | 18 ok, 2 errados |
| C17 (n=20, fora da lista) | 12 ok, 8 errados | 20 ok | 16 ok, 4 errados | 20 ok |

O C13 chamou `emit_artifact` em 20 de 20 conversas. Nenhuma chamada falhou.

### Contra o limiar {#against-the-threshold}

| modelo | espanhol onde se espera pt-BR (tratado) | corretos em C01–C04, C06–C15 (estrito, classificador) | veredito pelo classificador |
|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0 | 82/95 (86,3%), 8 indeterminados | **não passa** |
| `anthropic/claude-haiku-4.5` | 3 (todos no C05) | 81/95 (85,3%), 0 indeterminados | **não passa** |

As 13 falhas do DeepSeek formam dois grupos. A leitura abaixo foi a do agente,
feita ANTES da revisão; a revisão ([próxima seção](#human-review-and-the-haiku-diagnosis-at-167-follow-up))
a corrigiu — os 8 indeterminados não são todos prosa em inglês:

- os 8 indeterminados (C06 ×2, C12 ×6) parecem prosa em inglês — a lista
  `ampliada` pontua mal o inglês ("Great starting point — …");
- as 5 falhas do C11 respondem ao pedido de tradução com a **tradução em inglês
  dentro de uma moldura em português**, o que a orientação permite ("a menos que
  o usuário peça explicitamente … nesta mensagem" cobre a tradução, não a
  moldura). O "tradução em en" do protocolo não diz qual dos dois está certo.

Se a revisão aceitar os dois grupos, o DeepSeek chega a 95/95 e **passa**; se
recusar o C11, 90/95 (94,7%) e falha por uma resposta. O Haiku **falha de
qualquer jeito**: com a preferência `en` explícita e mensagens em português
(C12) ele respondeu em português em 10 de 10 respostas tratadas, e respondeu 3
de 5 mensagens em espanhol em espanhol (C05). Uma hipótese, não medida: para
modelos da Anthropic o OpenRouter sobe a mensagem `system` do fim para o system
prompt do topo, onde ela perde a recência que tem no fim da lista. (Medido
depois, e **não confirmado**: veja o diagnóstico abaixo.)

As respostas a revisar (toda indeterminada ou divergente, toda tradução do C11,
e uma amostra determinística de 1 em 10 das concordantes) são 146 de 560,
listadas em `revisao.md` na pasta de saída.

### Custo incremental da orientação {#incremental-cost-of-the-orientation}

`prompt_tokens` pareados da **primeira** chamada de cada conversa (entrada
idêntica nos dois braços, salvo a orientação), tirados do `usage` do OpenRouter,
nunca estimados:

| modelo | orientação | pares | Δ tokens de entrada |
|---|---|---|---|
| DeepSeek | pt-BR (108 caracteres) | 75 | 32 (todo par) |
| DeepSeek | en + cláusula de artefato (128 caracteres) | 15 | 27 |
| Haiku | pt-BR | 75 | 30 |
| Haiku | en + cláusula de artefato | 15 | 27 |

Tudo abaixo do teto de 50 tokens. Ao preço de entrada do catálogo isso dá cerca
de US$ 0,0000096 por chamada no DeepSeek e US$ 0,00003 no Haiku — um limite
superior, já que o DeepSeek serviu a maior parte da entrada do cache (os tokens
em cache são devolvidos; o custo por chamada com cache está dentro de
`usage.cost`, não separado por mensagem). A orientação vai em toda chamada de
um turno, então um turno com iterações de ferramenta a paga uma vez por iteração.

### Gasto {#spend}

O custo da validação é a soma do `usage.cost` de cada resposta, guardado por
chamada em `chamadas.jsonl`: **US$ 2,3071** no total — US$ 2,2629 nas execuções
contadas (DeepSeek 0,1526 baseline + 0,2133 tratamento; Haiku 0,9526 + 0,9443;
865 chamadas), US$ 0,0281 no passo zero descartado e US$ 0,0162 num smoke de um
caso. O contador de `GET /api/v1/key` foi de 1,8301 a 4,1578 (Δ 2,3277) no mesmo
período, mas a chave é compartilhada com outras lanes pagas rodando ao mesmo
tempo e o contador atrasa, então esse delta é contexto, não o gasto desta
validação. Os ids de geração não foram gravados, então o custo por chamada não
foi conferido contra `GET /api/v1/generation`. O metering do próprio produto
(`token_usage`) não entrou: o script passa por fora da api.

### Como reproduzir {#reproducing}

```bash
# the key file holds OPENROUTER_TEST_KEY=…; the key is never printed
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --modelos deepseek/deepseek-v4.1-flash --bracos baseline --casos C01,C02,C03,C04   # step zero
pnpm --filter @brabo/scripts idioma:validar --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --pular-existentes --teto-usd 2.5                                                 # everything else
pnpm --filter @brabo/scripts idioma:validar --relatorio                             # report only
```

A saída vai para `$XDG_CACHE_HOME/brabo/validacao-idioma/<date>/` (senão
`~/.cache/…`), modo 600, e o script recusa pasta dentro do checkout.
`--teto-usd` para antes da chamada que o ultrapassaria, pela soma corrente de
`usage.cost`.

Não medidos: a economia de cache em si, o system prompt completo do produto, a
compactação real (disparada por limiar), um reinício do engine real, a contagem
do tokenizador da cláusula de artefato em português, e qualquer upstream fixo.

As 146 respostas foram revisadas à mão; o resultado, e a única decisão que
continua sendo do dono, estão na próxima seção.

## Revisão humana e o diagnóstico do Haiku (continuação da AT-167) {#human-review-and-the-haiku-diagnosis-at-167-follow-up}

Duas continuações offline ou baratas da validação paga, ambas sobre a mesma
execução (`respostas.jsonl`, 560 respostas julgadas): a revisão humana das 146
respostas que o classificador sinalizou (Parte A, sem gasto), e o teste da
hipótese "o OpenRouter iça a mensagem `system` do fim" para o Haiku (Parte B,
US$ 0,1485). Nenhuma das duas muda o produto.

### Parte A — a revisão das 146 {#part-a--the-review-of-the-146}

Cada uma das 146 respostas de `revisao.md` foi lida, uma a uma, pelo agente que
escreveu esta seção (não por um segundo humano; o arquivo de rótulos fica
guardado para quem quiser contradizê-lo). Para cada uma: o idioma **real** do
texto que o usuário lê, se ele está correto para o caso, e um motivo em uma
linha. Os arquivos moram fora do git, junto com as respostas —
`~/.cache/brabo/validacao-idioma/2026-09-29/revisao-feita.md` (as 146) e
`amostra-lida.md` (a amostra abaixo). `pnpm --filter @brabo/scripts
idioma:revisar` os lê e imprime toda tabela desta seção; os rótulos são dado, a
aritmética é código (`scripts/idioma/revisao.ts`, testado).

Os rótulos são quatro, porque a leitura achou um fato que o classificador não
enxerga:

- `sim` / `nao`: a resposta está / não está no idioma esperado;
- `formulario`: a **prosa** está no idioma esperado, mas as perguntas do
  formulário estruturado (`ask_structured_questions`, a substância de uma
  primeira resposta) saíram em português para um autor cujo idioma é `en`;
- `c11`: uma tradução para o inglês dentro de uma moldura em português — decisão
  do dono, veja abaixo.

| das 146 | corretas | incorretas | prosa certa, formulário em português | C11 (decisão do dono) |
|---|---|---|---|---|
| todas | 42 | 81 | 8 | 15 |
| braço baseline (89) | 18 | 64 | 1 | 6 |
| braço tratado (57) | 24 | 17 | 7 | 9 |

As 14 respostas que o classificador chamou de **indeterminadas** eram, uma vez
lidas: 3 respostas em inglês (traduções simples do C11 pelo Haiku), 2
incorretas (DeepSeek C12, frases em português e em inglês intercaladas na
prosa), 8 de prosa em inglês com o formulário em português, e 1 C11. Então a
frase anterior do agente — "os 8 indeterminados parecem prosa em inglês" —
estava meio certa: a prosa era inglês, e o formulário **não** era em 6 dos 8.

**O erro do classificador, medido.** Nos 118 vereditos definitivos
(`pt`/`es`/`en`) entre as 146 respostas lidas, a leitura contradisse **0**. O
classificador nunca chamou de certa uma resposta errada, nem de errada uma
certa; as únicas falhas dele são as 3 "indeterminadas" que eram inglês simples.
Para as 414 respostas que **não** foram sinalizadas (todas concordantes com a
expectativa), uma amostra foi lida: 60 sorteadas com
`random.Random(20260929).sample(range(414), 60)` sobre as respostas na ordem de
`respostas.jsonl`, mais as 14 respostas C06/C12 não sinalizadas com `en`
esperado que o sorteio não pegou (elas decidem o limiar, então foram lidas
inteiras) — 74 lidas, **0 divergentes** (limite superior de Wilson a 95%: 4,9%).
Somadas às 39 respostas concordantes que o hash de 1 em 10 já tinha sinalizado
e que também foram lidas, a parte aleatória dá 0 em 99 (limite superior 3,7%):
no máximo ~15 das 414 poderiam estar erradas, e a amostra sugere nenhuma. Dois
deslizes vistos na amostra são inserções de uma palavra (`"What falta for us…"`,
`"reminders automáticos"`) que não mudam o idioma da resposta.

O que o classificador **não** consegue ver é o formulário: `clf=en` numa
resposta em inglês não dizia que as perguntas dela estavam em português (ele só
sinalizou essas respostas como indeterminadas quando a mistura era pesada). É
por isso que a amostra leu inteiras as respostas C06/C12, e por isso que existem
as duas leituras abaixo.

### O limiar, recalculado com os rótulos revisados {#the-threshold-recomputed-with-the-reviewed-labels}

Braço tratado, C01–C04 e C06–C15 (n = 95), espanhol contado pelo idioma
**real** de toda resposta tratada onde se espera pt-BR (C05 incluído). Intervalo
de Wilson a 95%. Duas leituras independentes: **C11** (a do dono, em aberto) e
**formulário** (prosa certa, formulário em português — o agente a resolveu como
fato sobre o que o usuário lê, e mostra o outro lado para que possa ser
contradito).

| modelo | C11 conta | formulário conta | acertos | taxa | intervalo de 95% | espanhol (pt esperado) | veredito |
|---|---|---|---|---|---|---|---|
| DeepSeek | sim | sim | 93/95 | 97,9% | 92,6–99,4% | 0 | passa |
| DeepSeek | **sim** | **não** | 87/95 | 91,6% | 84,3–95,7% | 0 | não passa |
| DeepSeek | não | sim | 88/95 | 92,6% | 85,6–96,4% | 0 | não passa |
| DeepSeek | não | não | 82/95 | 86,3% | 78,0–91,8% | 0 | não passa |
| Haiku | sim | (qualquer) | 85/95 | 89,5% | 81,7–94,2% | 3 (C05) | não passa |
| Haiku | não | (qualquer) | 81/95 | 85,3% | 76,8–91,0% | 3 (C05) | não passa |

O limiar de aprovação é 91 acertos de 95 (94,7% reprova). Lendo a tabela:

- **O Haiku falha em toda leitura**: 3 respostas em espanhol no C05 (só a
  cláusula de zero espanhol já basta) e, com tudo aceito, 85/95.
- **O DeepSeek passa em exatamente uma célula**: C11 aceito **e** prosa em
  inglês com formulário em português aceita. Recuse qualquer um dos dois e ele
  falha — por 4 respostas se o formulário for recusado (87 dos 91 necessários),
  por 3 se for o C11 (88). Recuse os dois e é o número do classificador, 82.
- A decisão do C11 portanto só importa se o formulário for aceito. Com o
  formulário contado como falha, o DeepSeek falha seja qual for o C11, e o
  achado sobre o qual agir não é o C11 mas o formulário: no braço tratado, 8 das
  15 respostas C06+C12 do DeepSeek trazem texto em português dentro de uma
  resposta em inglês (6 só no formulário, 2 intercaladas), enquanto 7 são inglês
  limpo, formulários incluídos. O modelo consegue escrever o formulário em
  inglês — faz isso mais ou menos metade das vezes.
  **De onde veio (AT-282, [RN-667](../business-rules.md#rn-667)):** a própria
  descrição da ferramenta dizia ao modelo que o `label` era "o texto da pergunta,
  **em pt-BR**" — uma segunda instrução de idioma, fixa, fora da fachada,
  competindo com a orientação do fim em toda chamada. Agora ela diz "no idioma
  da sua resposta" e não nomeia idioma; a orientação em si não mudou. A medição
  do depois **não foi rodada** (sem chave do OpenRouter na máquina que fez a
  mudança) e está pendente com o dono — C06 e C12, braço tratado, 5 rodadas,
  com o teto de orçamento da RN.

O que o C11 é, nos dados. As 5 falhas tratadas do DeepSeek: 3 têm a tradução em
inglês citada numa moldura em português ("Registrei a regra… A tradução que
você pediu: > …"), e 2 **não têm tradução no texto gravado** — a execução guarda
só a última mensagem de um turno, e esses turnos chamaram `emit_artifact`
primeiro, então a tradução estava numa mensagem anterior do mesmo turno (10
chamadas para 5 conversas, duas por conversa), então a tradução presumivelmente
estava numa mensagem anterior do mesmo turno, e não foi guardada. As duas são
contadas como só-moldura, ou seja, como acertos em "C11 conta". As 4 falhas
tratadas do Haiku são uma tradução em inglês com uma nota em português ou
alternativas em português em volta.

> **TODO(humano):** Uma tradução para o inglês dentro de uma moldura em português
> conta como correta no C11? Ela decide o eixo C11 da tabela acima:
> **aceita** → DeepSeek 93/95 e passa (se a prosa em inglês com formulário em
> português também for aceita; 87/95 se não); **recusada** → DeepSeek 88/95 (ou
> 82/95) e falha. O Haiku falha de qualquer jeito. Recomendação, em uma frase:
> aceitar — a exceção da orientação cobre só a tradução pedida e a moldura fica
> no idioma do autor, então recusá-la penalizaria exatamente o comportamento que
> a orientação existe para produzir. (A segunda pergunta, o formulário em
> português, é de escopo de produto e está enunciada como achado acima; não foi
> levada ao dono porque o agente a resolveu como fato — o que o usuário lê.)

### Parte B — é a posição da orientação? (AT-279) {#part-b--is-it-the-position-of-the-orientation-at-279}

A hipótese: para modelos da Anthropic o OpenRouter sobe a mensagem `system` do
fim para o system prompt do topo, perdendo a recência dela. Teste: C12
(preferência do autor `en`, mensagens em pt-BR), `anthropic/claude-haiku-4.5`,
primeiro turno, 5 rodadas por posição, o texto da orientação **lido do produto**
(era `Respond in English (en), unless the user explicitly asks for another language
in this message. Write project artifacts in pt-BR.`), variando só a posição:

1. `ultima-system` — como hoje (`idioma_da_resposta.ex:231`, um
   `role: "system"` no fim);
2. `system-fundido` — acrescentada ao primeiro `system` (persona + orientação);
3. `sufixo-user` — sufixo da última mensagem `user`, **sem** `system` acrescentado;
4. `ultima-system-e-sufixo-user` — o `system` do fim **mais** a mesma frase como
   sufixo.

| posição | acertos do classificador | leitura |
|---|---|---|
| 1 `ultima-system` (como hoje) | 0/5 | 5 em português, formulários incluídos |
| 2 `system-fundido` | 0/5 | 5 em português |
| 3 `sufixo-user` | 0/5 | 5 em português |
| 4 `ultima-system-e-sufixo-user` | 0/5 | 5 em português |
| controle: 1, sem a cláusula de artefato | 0/5 | 5 em português |
| controle: 3, sem a cláusula de artefato | 0/5 | 5 em português |

As quatro posições foram lidas por inteiro e os dois controles em parte, e as
30 respostas foram também conferidas atrás de palavras funcionais do inglês
(nenhuma em nenhuma): as 30 são em português, prosa e formulário. O defeito da
posição 1 é **reproduzido** (0/5, como o 0/10 da execução paga), e **nenhuma
posição o corrige** — nem aquela em que a orientação está dentro da própria
última mensagem do usuário e não há `system` no fim. A hipótese **não se
confirma**. As contagens de tokens de prompt mostram que o texto chegou ao
modelo em toda posição (2 426, 2 427, 2 427 e 2 454 tokens de entrada: +1 para
as duas colocações simples e +28 para a dupla), então não é mensagem descartada.
O controle exclui também a segunda frase suspeita: a cláusula de artefato
("Write project artifacts in pt-BR.", RN-623) também não é a causa (0/10 sem
ela).

O que isto não exclui, e não foi medido: o segundo turno (só o primeiro rodou,
por orçamento — a execução paga teve o segundo turno errado 5/5 também); uma
redação mais forte (a frase diz "unless the user explicitly asks", e entrada em
português pode ser lida assim); o idioma da própria persona
(`CRIATIVO_INSTRUCTIONS` é em português); e o upstream (as 30 chamadas foram
servidas pelo Amazon Bedrock, então um efeito de upstream não pode ser
separado). O DeepSeek segue a mesma orientação no mesmo caso — as respostas C12
tratadas dele foram prosa em inglês em 8 de 10 —, o que aponta para o modelo,
não para a colocação.

**Mudança proposta: nenhuma sobre posição.** O único lugar onde uma posição
seria mudada, se tivesse ajudado, é `Engine.Harness.IdiomaDaResposta.anexar/4`
(`apps/engine/lib/engine/harness/idioma_da_resposta.ex:231`, o `messages ++
[%{"role" => "system", …}]`), chamado pelos dois caminhos `llm_turn` de
`apps/engine/lib/engine/sessions/engine_api_client.ex:609` e `:661`. Ele fica
como está. A próxima atividade, se o dono quiser que o Haiku obedeça `en` diante
de entrada em português, é testar a redação e o idioma da persona (a lista
acima), com este mesmo script.

**Gasto** (soma do `usage.cost` de cada resposta, nunca o contador de `/key`):
US$ 0,0980 para as quatro posições (20 chamadas) e US$ 0,0505 para os dois
controles (10 chamadas) — **US$ 0,1485** do teto de US$ 0,20, 30 chamadas,
nenhuma falhou.

Para reproduzir a Parte B (o arquivo de chave guarda `OPENROUTER_TEST_KEY=…`;
ela nunca é impressa; a saída vai para fora do checkout):

```bash
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --teto-usd 0.13 --concorrencia 4          # the four positions
pnpm --filter @brabo/scripts idioma:diagnosticar \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env \
  --turnos 1 --rodadas 5 --posicoes ultima-system,sufixo-user --sem-clausula \
  --saida ~/.cache/brabo/validacao-idioma/<date>-diagnostico-haiku-sem-clausula \
  --teto-usd 0.06 --concorrencia 4                                  # the controls
pnpm --filter @brabo/scripts idioma:revisar                          # Part A tables
```

`--turnos N` e `--sem-clausula` existem só para este diagnóstico; o produto
nunca põe a orientação em outro lugar que não o fim, e `posicionar` em
`validacao.ts` não é usado por ele.
