# Esqueleto da colheita (10c)

Material de trabalho. **Este arquivo não é o relatório** — é o molde dele.

Quando a 10b tiver rodado, preencha os marcadores, escreva a prosa, e **mova**
o resultado para `docs/explanation/primeiro-dogfooding.md`, que é página
publicada e portanto precisa de frontmatter (`id`, `title`, `sidebar_label`,
`sidebar_position`, `description`, `keywords`, no padrão de
`docs/explanation/documentation-workflow.md`) e de entrada em
`website/sidebars.ts`. Este arquivo mora em `docs/missions/`, excluído do build,
justamente para o esqueleto não ir ao ar dizendo nada.

**Como preencher.** Cada número aparece como `<!-- query: nome -->`. O nome é o
bloco correspondente em `docs/missions/colheita-queries.sql`. Rode:

```bash
pnpm --filter api db:migrate     # obrigatório: as queries de custo usam colunas da Fase 9
docker exec -i brabo-postgres-1 psql -U brabo -d brabo \
  -f - < docs/missions/colheita-queries.sql
```

**Regra que vale mais que o prazo:** nenhum número entra sem query que o
produza. O que não fechar entra como "não medido" — nunca como estimativa
(princípio 6 da missão).

---

## 1. A resposta

> A pergunta que a fase existe para responder: **quanto custou, em dinheiro e em
> atenção humana, cada provider — e o Brabo compensa?**

Responda em três parágrafos, nesta ordem, antes de qualquer tabela. Quem lê isto
daqui a um ano quer a conclusão, não a apuração.

| provider | sessões | chamadas de LLM | custo (USD) | cliques que custou |
|---|---|---|---|---|
| Bitbucket | <!-- query: a-pergunta-da-fase --> | | | |
| Generic | <!-- query: a-pergunta-da-fase --> | | | |

**Compensa?** Não responda com o custo isolado. A comparação honesta é contra o
que o mesmo trabalho custaria fora do Brabo — e o número que ninguém mais mede é
o da coluna da direita: quantas vezes uma pessoa teve que parar o que estava
fazendo para decidir.

> ⚠️ Se o Arquiteto não separou os dois providers em módulos distintos no
> `module_map`, esta tabela não separa também. Isso é achado — registre em §8 em
> vez de rateio inventado.

---

## 2. Consolidação por sessão

Copie a tabela preenchida da missão (Parte 4.1) e confronte com o banco.

| # | sessão | task | cliques | intervenções | restarts | custo | gates | nota |
|---|---|---|---|---|---|---|---|---|
| | | | <!-- query: cliques-por-sessao --> | | | <!-- query: custo-por-agente --> | <!-- query: voltas-de-gate --> | |

**Divergência entre a anotação e o banco é achado sobre a observabilidade, não
erro seu.** Registre as duas colunas lado a lado quando divergirem, e explique em
§8. Duas fontes de divergência já conhecidas antes de começar:

- a contagem de cliques **não está no event log** (achado #17) — a fonte é
  `proposed_actions.decided_at`;
- `restarts do engine` não tem registro nenhum no sistema. É só a sua anotação.
  Se você não anotou, ficou perdido.

---

## 3. Onde a atenção humana foi gasta

<!-- query: cliques-por-tipo -->

| tipo de ação | cliques | passou sem clique | % que exigiu humano |
|---|---|---|---|

A leitura que interessa: **qual tipo de ação concentrou a fadiga.** Se um só tipo
responde pela maioria dos cliques, aí está o candidato natural a afrouxamento de
política — e a fase mediu justamente o custo de *não* ter afrouxado nada.

---

## 4. Custo

### Por agente

<!-- query: custo-por-agente -->

| agente | chamadas | tokens in | tokens out | USD | contagens estimadas |
|---|---|---|---|---|---|

A coluna de **contagens estimadas** importa: são chamadas em que o provider não
informou `usage` e o número saiu do tokenizer local (RN-041). Custo com muitas
estimativas é menos confiável, e dizer isso é mais honesto que arredondar.

### Por provider de LLM

<!-- query: custo-por-provider-de-llm -->

| provider de entrada | provedor real | modelo | chamadas | USD |
|---|---|---|---|---|

### O custo é reproduzível?

<!-- query: custo-reproduzivel -->

Esperado: **nenhuma linha na categoria `nao_fecha`**. Linhas em
`sem_preco_gravado` são anteriores às migrações da Fase 9 e não são defeito.

Se aparecer `nao_fecha`, isso contradiz a RN-044 e vira achado P1 sobre o
metering — mais importante que qualquer número desta seção, porque coloca todos
os outros em dúvida.

---

## 5. Gates

### Voltas de correção

<!-- query: voltas-de-gate -->

| task | gate | voltas | bloqueada | origem |
|---|---|---|---|---|

Task bloqueada com `blocked_origin` preenchida esgotou o ciclo K (teto 3, salvo
configuração na ativação). **A origem é o dado**: `infra` e `modelo` dizem coisas
opostas sobre o produto — a primeira é ambiente, a segunda é o agente não dando
conta.

### A área de QA funcionou?

<!-- query: delegacoes-e-dispensas -->

| área | lead | subagente | status | quantas | com falha |
|---|---|---|---|---|---|

Três perguntas a responder em prosa:

1. O parecer consolidado dizia algo **útil**, ou era colagem dos sub-pareceres?
2. As dispensas foram justificadas de forma **verificável**?
3. A subespecialidade de Performance/Segurança chegou a rodar? Se só houve
   dispensa, a causa provável é nenhuma story ter RNF com uma das palavras-chave
   que o QA Lead reconhece — o que é achado sobre a heurística, não sobre o QA.

---

## 6. O loop Psicólogo → Anamnese

**Leia as hipóteses agora, em lote — não antes.** Se você leu durante a fase, diga
isso aqui: contamina a interpretação e é honesto registrar.

<!-- query: hipoteses-e-decisoes -->

| agente-alvo | status | quantas | confiança média | evidências por hipótese |
|---|---|---|---|---|

<!-- query: hipotese-para-patch -->

| hipótese | decisão | virou patch? | versão | decisão do patch |
|---|---|---|---|---|

O que a tabela precisa provar:

- **hipótese aceita que não virou patch** (`patch_id` nulo) — o loop não fechou, e
  isso é achado;
- **patch negado que foi reproposto** — contradiz a RN-026 e é achado grande;
- se você negou ao menos um de propósito, como a missão pedia (2.3), diga o que
  aconteceu depois.

---

## 7. Linha do tempo das PRs

<!-- query: linha-do-tempo-das-prs -->

| quando | quem abriu | título | branch | onde parou |
|---|---|---|---|---|

Lembre que `awaiting_user` é terminal **de propósito**: o merge acontece no
provider de git, fora do produto. PR parada ali não está travada — está esperando
você, como desenhado.

---

## 8. Promessa × realidade

A seção mais importante, e a única que não sai de query. Prosa honesta.

### O que não funcionou como prometido

Os achados #1–#17 da missão já estão levantados e **não precisam ser
redescobertos** — referencie-os. O que esta seção acrescenta é o que só a
execução revela: onde o produto travou de verdade, quantas vezes, e quanto custou
contornar.

### O que os agentes fizeram MELHOR que o esperado

Seção obrigatória, e resista a deixá-la vazia por modéstia ou por viés: um
relatório que só lista falhas é tão inútil quanto um que só lista sucessos.
Perguntas que ajudam a encontrar material:

- Algum parecer de QA pegou algo que **você** teria deixado passar?
- Algum agente resolveu uma ambiguidade do backlog sem precisar perguntar?
- O SecOps determinístico achou algo real, ou só ruído?
- Alguma hipótese do Psicólogo estava **certa** de um jeito que te surpreendeu?
- O ADR do Arquiteto ficou melhor do que você teria escrito com o mesmo tempo?

### O que mudou de opinião

Se a fase te fez mudar de ideia sobre alguma decisão de arquitetura anterior,
este é o lugar. É o parágrafo mais valioso do documento e o mais fácil de omitir.

---

## 9. Roteiro do ADR

O ADR nasce **aqui**, na colheita, com o próximo número livre na hora — não
antes. ADR é registro de decisão, e as decisões saem dos dados; um ADR criado
vazio queimaria o número e nasceria destinado a ser reescrito, contra a regra de
que ADR aceito nunca é editado.

Título sugerido: **"primeiro dogfooding"**. Três seções, só elas (Contexto,
Decisão, Consequências), como todo ADR do repositório.

**Contexto** — o que a fase se propôs a medir e o que de fato mediu.

**Decisão** — os aprendizados **estruturais**, não a lista de bugs. O que a fase
ensinou sobre o desenho do produto que vale mudar. Candidatos que a preparação já
sugere, a confirmar ou refutar com os dados:

- o gargalo de uma task por agente é limitação de desenho ou de implementação?
- a métrica central da fase não estar no event log é acidente ou sintoma de o
  event log servir a outro propósito?
- áreas hardcoded resolveram bem o suficiente, ou a tabela do ADR 0038 faz falta?

**Consequências** — o backlog priorizado. Formato:

| # | item | prio | justificativa |
|---|---|---|---|
| | | P1/P2/P3 | por que esta prioridade, com o dado que a sustenta |

**P1** = impede o produto de fazer o que promete. **P2** = custa caro em atenção
ou dinheiro, mas tem contorno. **P3** = incômodo ou dívida de clareza.

**Nenhum fix embutido.** O ADR registra o que foi decidido fazer; não faz.

---

## 10. Entrega técnica

Status verificado em **2026-08-01**, antes de a 10b rodar. Reconfira na colheita.

| critério | status | evidência |
|---|---|---|
| suite de contrato verde nos 5 providers | ⛔ **3** — local, github, gitlab | 5 chamadas a `runGitProviderContract`, 3 providers distintos |
| wizard com Bitbucket e Generic | ⛔ ausentes | `apps/web/src/routes/NewProjectWizard.tsx:34-36` |
| degradação do Generic testada | ⛔ não existe | nenhum arquivo `*generic-git*` em `apps/` |
| divergência "sem Bitbucket na UI" removida | ⛔ travada por teste | `apps/web/src/components/ProjectCard.test.tsx:69` afirma "só github, gitlab ou local — sem Bitbucket"; `design/COMPONENTS.md:222` pede grid 2x2 **com** Bitbucket |
| docmap / CHANGELOG / docs verdes | ✅ | `pnpm docs:check` e `pnpm docs:build` passam |

Sobre o quarto item: a divergência **não é esquecimento** — é trancada por um
teste que afirma existirem só três providers. Implementar o Bitbucket vai
reprovar esse teste, e isso é o mecanismo funcionando. Na colheita, registre se
o agente entendeu isso sozinho ou se precisou de intervenção.
