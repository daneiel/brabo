# 0198 — A duplicata semântica de história e regra é avisada por embedding com limiar, e o gasto entra no metering

## Status

**Accepted.** 2026-10-01 (AT-171, história HS-047, épico EP-026, rodada 36;
decisão do dono em 01/10: *"embedding com limiar, só avisa"* — compara na
emissão com as histórias e regras existentes do projeto e AVISA acima do
limiar, nunca bloqueia; o gasto do embedding desta checagem entra no metering
como linha própria). Abre UMA exceção ao corte de metering do
[ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md) sem editá-lo: o
corte continua valendo para a indexação e a busca do RAG
([ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md)); só esta checagem passa
a gravar `token_usage`. Fecha a metade que a [RN-080](../business-rules/custo.md#rn-080)
e a [RN-081](../business-rules/custo.md#rn-081) declaravam fora de alcance,
sem mudar nenhuma das duas: a duplicata EXATA continua recusada.

## Context

Medido no código de `dev` em 2026-10-01, antes de mudar:

- **Onde a emissão acontece.** História: `create_story` do PO
  (`apps/engine/lib/engine/harness/tools/create_story.ex`) chama
  `POST /internal/sessions/:id/stories`, e quem cria é
  `CreateStoryUseCase` na api — título igual recusa, justificativa contida
  avisa (RN-081). Regra de negócio: `emit_artifact` (o Criativo e outros cinco
  conversacionais) grava o evento `artifact.business_rule` pela api
  (`append_event`), depois de `ArtifactDedupe` recusar título igual (RN-080).
  Não há tabela de regras: a regra É o evento. Nenhum dos dois servidores
  (`po_server.ex`, `criativo_server.ex`) precisou mudar — a emissão mora nas
  duas ferramentas.
- **Como o RAG chama o `embed`.** Por um ponto só, `RagEmbeddingService`,
  com provider e modelo FIXOS (`ollama`/`nomic-embed-text`, 768 dimensões —
  RN-222/233): o único provider que declara `capabilities.embeddings`
  (RN-191). Falha vira `available: false` com motivo, nunca exceção. O
  serviço descartava o `inputTokens` que o contrato devolve — o corte do 0075.
- **Se há vetores guardados.** Não há. `chunks` indexa `chat.message`,
  `agent.response`, `docs/` e ADR; nenhum `artifact.*`, nenhuma história. A
  checagem tem de vetorizar na hora.
- **Por que o corte do 0075 não alcança esta checagem.** O motivo dele era
  estrutural: `token_usage.session_id` é `NOT NULL`, e indexar repositório não
  acontece em sessão. Emitir história ou regra acontece SEMPRE dentro de uma
  sessão do agente — o `session_id` existe.

## Decision

1. **O quê compara.** O TÍTULO novo contra os títulos das existentes do MESMO
   tipo no PROJETO (história com história, regra com regra), por cosseno entre
   vetores do modelo do RAG, chamado pelo MESMO `RagEmbeddingService` — nunca
   um segundo caminho até o `embed`. Título, e não título+descrição: o par do
   achado R é de títulos, e a descrição muda de tamanho e de tom entre turnos
   do modelo (custo e ruído sem caso que o peça). A duplicata exata (título
   normalizado igual) não é assunto daqui — é recusada antes, pela RN-080/081,
   e por isso também sai da comparação.
2. **Só AVISA.** A checagem roda DEPOIS de gravar: a história e a regra
   existem com ou sem aviso. O aviso volta ao agente como parte do resultado
   da ferramenta (`create_story`, `emit_artifact`) e fica no log como
   `backlog.semantic_duplicate_warned`, nomeando o item parecido e o número.
3. **O limiar é 0,80, PONTO DE PARTIDA não calibrado** — como os quatro
   números da busca híbrida do 0080. "A partir de": igual avisa. Ver "O que
   não foi medido". Errar para baixo custa um aviso a mais, que não bloqueia
   nada; é por isso que um número provisório cabe aqui e não caberia numa
   recusa.
4. **Sem provider de embedding, a checagem é PULADA e DITA.** Capability
   ausente, daemon fora do ar, modelo não puxado, ou o teto de tempo — tudo
   vira `status: skipped` com o motivo, narrado como
   `backlog.semantic_duplicate_check_skipped` e na frase ao agente. Nunca falha
   a emissão, nunca é silenciosa: sem isto, "nenhum aviso" se leria como "não é
   duplicata".
5. **O gasto entra no metering como LINHA PRÓPRIA.** Pelo único caminho,
   `RecordLlmUsageUseCase`, com ator `system`/`duplicata-semantica` (fora das
   somas por agente, RN-038, e do gasto de área, ADR 0110), provider/modelo do
   RAG, `output_tokens = 0`, `input_tokens` e `estimated` do que o provider
   disse, preço do catálogo quando o modelo está nele (senão 0, com
   `model_id` nulo). `RagEmbeddingService` passa a DEVOLVER o uso somado
   (`uso`); a indexação e a busca o ignoram, e é isso que mantém o corte do 0075
   para elas.
6. **Tetos.** As 100 existentes MAIS RECENTES, no máximo
   (`TETO_DE_COMPARACOES_DE_DUPLICATA`), num lote só; quando corta, o
   resultado diz quantas de quantas (RN-180). E 10 s de relógio para a checagem
   inteira (`TETO_DE_TEMPO_DA_CHECAGEM_MS`), abaixo dos 15 s do `Req` do engine
   que a chama: o timeout do Ollama chega a 300 s na instalação, e a checagem
   está no caminho de uma ferramenta do agente.
7. **Sem migration.** Nada é guardado: nem vetor, nem coluna nova. A linha
   própria em `token_usage` se distingue pelo ator, que já existe.

## Consequences

**O custo de emitir passa a crescer com o projeto.** Cada emissão vetoriza
`min(N, 100) + 1` títulos, N = existentes do mesmo tipo. Título de história ou
regra tem de 5 a 15 palavras; com o tokenizador de `nomic-embed-text` isso é
ESTIMADO em 10–30 tokens por título, ou seja, até ~3 000 tokens de entrada por
emissão no teto — com o Ollama local, preço de catálogo 0 e custo 0 micros; o
que cresce é a LATÊNCIA, não medida aqui. O número real sai do metering, que é
para isso que a linha existe. Guardar o vetor de cada item (coluna em
`stories`, tabela para as regras-evento) reduziria a uma chamada por emissão, e
é migration — fica para quando o custo medido pedir.

**O par do achado R deixa de passar despercebido — se o limiar estiver
certo.** E esse "se" é a lacuna desta decisão (abaixo).

**A frase do aviso tem UMA fonte**, `fraseParaOAgente` na api; o engine só a
repassa. A mesma checagem serve os dois tipos.

**O que continua passando.** Duplicata cujo sentido está na DESCRIÇÃO e não no
título ("Saudação com nome" × "Quem chama pode se identificar", o exemplo da
RN-080) não é comparada. Um aviso perdido por timeout é dito, mas a checagem
não é refeita. E o budget com `policy = 'block'` ([RN-019](../business-rules/custo.md#rn-019))
não é consultado ANTES desta chamada: a linha soma ao gasto e pode cruzar os
limiares, mas a checagem não é recusada por orçamento estourado — ela não
bloqueia nada, e com o Ollama local o custo gravado é 0. Se um provider pago de
embedding entrar, essa escolha volta à mesa.

**O que este ADR NÃO muda:** a recusa da duplicata exata (RN-080/081), o corte
de metering da indexação e da busca (ADR 0075), o modelo e o provider fixos do
RAG (ADR 0080), e nenhum servidor conversacional.

## O que não foi medido

A decisão do dono pedia calibrar o limiar com o par do achado R e com pares que
NÃO são duplicata, provando por teste com vetores gravados. O ambiente em que
esta mudança nasceu **não alcançava** o registry do Ollama
(`registry.ollama.ai`: 403 no proxy) nem o Hugging Face (403), e não tinha o
daemon — medido em 2026-10-01. Vetor escrito à mão provaria a mão, não o
modelo. O que existe, então:

- `apps/api/test/fixtures/duplicata-semantica/pares.json` — os pares de
  calibração: o do achado R e duas paráfrases que TÊM de avisar; cinco pares
  de assunto vizinho que NÃO podem.
- `apps/api/scripts/gravar-vetores-de-duplicata.ts` — grava `vetores.json`
  contra o Ollama real, com o modelo que o daemon disse ter usado, e imprime o
  cosseno de cada par contra o limiar vigente.
- `apps/api/test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts` —
  roda sozinha quando `vetores.json` existe: todo par `duplicata` avisa, todo
  `distinta` passa. Sem o arquivo, PULA com aviso nomeado (a régua do smoke de
  embedding do Ollama), nunca passa calada.

Até alguém gravar os vetores, 0,80 é conhecimento geral sobre modelos de
embedding de frase, não medição. Se a gravação mostrar que nenhum número separa
os dois lados, a resposta é rever os pares ou o texto comparado — nunca afrouxar
o teste.
