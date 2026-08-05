# ADR 0053 — Dev Lead como área, e paralelismo autorizado pelo usuário

- **Status:** Proposto
- **Data:** 2026-08-05
- **Contexto:** FASE 14d
- **Revoga cortes de:** [ADR 0038](0038-hierarquia-de-agentes.md) (o
  aparato genérico de áreas, e as áreas dinâmicas via `module_map`)

## Contexto

Hoje o paralelismo dos dev agents é: um agente por módulo no `activate`, e um
extra por módulo (`dev-<modulo>-2`) por aceite de um clique
(`AcceptParallelizationUseCase`). Não há teto de sessão. Nada impede um projeto
de subir um agente por módulo mais um extra em cada, e o gasto sobe junto sem
que ninguém autorize.

A FASE 14d decide que **quem avalia quantos agentes valem a pena é o lead**, e
que passar de dois na sessão exige autorização do usuário.

### A tensão que este ADR resolve

O paralelismo em questão é o dos **devs**, e o **Dev Lead não existe**. As áreas
existentes são duas, com membros fixos escritos à mão em
`apps/web/src/lib/agents.ts`: `qa` (lead `qa`, membros `qa-automacao` e
`qa-performance-seguranca`) e `infra`.

Pior: o CLAUDE.md proibia explicitamente as duas coisas necessárias —
"não implementar Dev Lead nem áreas dinâmicas via `module_map`" e "não
implementar o aparato genérico de áreas (`agent_areas`/budget por área)".

A decisão do usuário é levantar as duas proibições e fazer o Dev Lead de
verdade. Este ADR registra isso e o porquê.

### Por que a área de dev não pode ser hardcoded

`qa` e `infra` têm membros conhecidos em tempo de escrita. A área de dev não: os
membros são **um por módulo do `module_map`**, que é decidido pelo Arquiteto, é
diferente em cada projeto e muda quando a arquitetura é revista.

É exatamente o caso que o corte da Fase 8 adiou. Ele foi honesto enquanto todas
as áreas eram estáticas; deixa de ser no momento em que a primeira área dinâmica
entra. Não há como fazer o Dev Lead sem o aparato — e é por isso que os dois
cortes caem juntos, não por conveniência.

## Decisão

### 1. As áreas viram dado, por projeto

Entram `agent_areas` e `agent_area_members`, escopadas por projeto:

- `agent_areas`: `project_id`, `key` (hoje `dev`, `qa`, `infra`),
  `lead_agent_id`, `max_parallel` (default **2**)
- `agent_area_members`: `area_id`, `agent_id`

`qa` e `infra` continuam nascendo com os membros que já têm — o aparato passa a
ser a fonte, e a lista hardcoded some de `agents.ts`. O **contrato externo dos
gates não muda**: quem consome vê um veredito por gate, exatamente como hoje, e
a suite da Fase 4 tem que ficar verde sem modificação. Essa é a prova de que a
troca de fonte não vazou para fora da área.

A área de `dev` nasce em `activate-execution`, com um membro por módulo do
`module_map` vigente.

### 2. O lead decide, o usuário autoriza acima de 2

O lead avalia quantos agentes valem a pena para o trabalho em mão — não é mais
um número no código. Mas a decisão dele não é soberana sobre gasto:

- até `max_parallel` (default 2), o lead sobe os agentes e segue;
- **acima disso**, vira `proposed_action` do tipo `parallelize`, pelo mesmo
  pipeline de aprovação de toda ação com efeito externo. O usuário decide, e a
  decisão fica no event log.

O teto é da **sessão**, não do módulo. Contar por módulo permitiria N módulos ×
2 agentes sem nenhuma autorização, que é o buraco de hoje com outro nome.

`AcceptParallelizationUseCase` (o aceite de um clique) é absorvido: vira o
caminho de aprovação dessa `proposed_action`, em vez de um botão paralelo ao
pipeline.

### 3. `max_parallel` é configurável por lead

Na tela de Configurações, cada lead tem o seu, com **2** como default. É o teto
que o lead pode usar sem perguntar — não o teto do que o usuário pode aprovar.

### 4. A Anamnese propõe subir quando a autorização é recorrente

Quando ela perceber que o usuário vem aprovando o mesmo pedido repetidamente,
propõe subir o `max_parallel` daquele lead — pela mesma mecânica de hipótese que
ela já usa, com evidência de event ids reais e o usuário decidindo.

O que ela **não** faz é subir sozinha. Automatizar isso seria o produto elevando
o próprio teto de gasto, que é precisamente o que o pipeline de aprovação existe
para impedir.

## Consequências

**A favor**

- O gasto com paralelismo passa a ter teto e dono. Hoje não tem nenhum dos dois.
- O aparato de áreas deixa de ser dívida declarada e vira mecanismo, com a
  primeira área dinâmica como prova de que ele serve para o caso difícil.
- `budget por área` (o outro item do corte da Fase 8) fica a um passo: a tabela
  que faltava passa a existir.

**Contra**

- É a maior mudança estrutural desde a Fase 8, e toca o fluxo de handoff: o
  Arquiteto passa a entregar ao Dev Lead, não à ativação manual do usuário.
- `delegations.area` é TEXT com "qa" e "infra" hoje; ganha "dev" e passa a ter
  uma fonte de verdade em tabela. A migração precisa manter o histórico legível.
- Trocar a fonte dos membros de `qa`/`infra` é risco puro sem benefício
  imediato para eles — mitigado por manter a suite da Fase 4 intocada como
  critério de aceite.

## Alternativas consideradas

**Teto de sessão sem Dev Lead.** Entregaria o valor central — teto de gasto com
autorização — sem violar corte nenhum, e era a recomendação. Recusada porque
deixa "quem decide é o lead" sem dono: o teto existiria, mas ninguém avaliaria
quantos agentes valem a pena, que é metade do que a 14d pede.

**Aplicar só a QA e Infra.** Fiel ao texto e implementável hoje, mas de valor
baixo: as duas áreas têm membros fixos, quase não há o que decidir, e não toca o
paralelismo dos devs — que é onde o gasto acontece.

**Número fixo maior no código.** É o que existe hoje com outro valor. Não
resolve nada: sem autorização, qualquer número é arbitrário.

## Referências

- [ADR 0038](0038-hierarquia-de-agentes.md) — hierarquia por área e os
  cortes que este ADR revoga
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — a máquina de
  estados do dev agent, onde os agentes extras entram
- `apps/api/src/db/schema.ts` (nota em `delegations`) — onde o corte está dito
- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  — o mecanismo de hoje, absorvido pelo item 2

> **TODO(humano):** o Dev Lead é um agente conversacional novo (recebe handoff
> do Arquiteto e conduz a execução) ou um papel do próprio Arquiteto ao ativar?
> A primeira opção muda a cadeia de handoff e pede instrução própria; a segunda
> é menor, mas deixa "lead" sem interlocutor no fio.
