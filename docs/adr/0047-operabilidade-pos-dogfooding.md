# 0047 — Operabilidade pós-dogfooding: o fechamento da Fase 12

## Contexto

A Fase 10 foi a primeira execução real do Brabo construindo o próprio Brabo. Ela
produziu dezessete achados, conservados em
[O que o primeiro dogfooding ensinou](../explanation/primeiro-dogfooding.md).
Três deles eram de **operabilidade** — o que separa um experimento conduzido à
mão de um sistema com que se convive:

| # | o que era | fechado por |
|---|---|---|
| 1 | o produto só sabia CRIAR repositório; apontar um projeto para um repo existente exigia inserir linhas à mão em duas tabelas | [ADR 0044](0044-adocao-de-repositorio-existente.md) |
| 10 | um dev agent processava UMA task e parava; a fase rodou em tandas, com restart do engine entre elas | [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) |
| 13 | a promoção `draft → ready` era automática na criação — o PO decidia sozinho o que entrava na fila dos devs | [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md) |

Os três já tinham teste próprio quando este ADR foi escrito. O que faltava era
outra coisa: **a prova de que morreram juntos**. Um sistema pode ter as três
correções e ainda assim não ser operável, se elas só funcionarem em isolamento —
foi exatamente o que a Fase 10 revelou sobre features que passavam nos testes de
suas fases e não sobreviviam ao primeiro contato com uso real.

## Decisão

**A validação é um script executável, não um roteiro em prosa.**
`apps/api/scripts/validacao-fase-12.ts`, no molde de `demo-noop-execution.ts`:
sobe o contexto Nest, chama os casos de uso reais e **sai com código diferente de
zero quando um critério não fecha**. A alternativa — um checklist para alguém
seguir clicando — produziria uma validação que envelhece em silêncio, do mesmo
jeito que a tabela de observação da Fase 10 ficou em branco.

**A evidência é extraída do banco, não transcrita.** O script termina imprimindo
uma tabela Markdown de `session_events.id` (ULID) da própria corrida, pronta para
colar no documento. E se recusa a terminar com sucesso se alguma etapa que ele
afirmou ter exercitado não deixou evidência no event log — sem essa checagem,
uma consulta errada produziria uma tabela curta e a validação passaria assim
mesmo, que é o modo de falha clássico de relatório gerado.

**A validação roda local e sem LLM, e isso é declarado no primeiro parágrafo do
documento.** Não no rodapé. Duas razões concretas, ambas verificadas:

- o **fork da Fase 10 nunca foi nomeado** — `dogfooding-mission.md:135` continua
  sendo um `TODO(humano)`, então não existe alvo para readotar. O caminho de
  adoção é o mesmo nos dois providers; o que muda é a rede, coberta pelo smoke
  `adopt-repository.smoke.spec.ts`, gated por credencial real;
- o **julgamento dos gates com modelo local não é determinístico**, e o
  [ADR 0020](0020-destravar-gates-qa-secops.md) já dizia isso. O veredito entra
  pelo `RecordGateVerdictUseCase`, que é o funil REAL onde nasce
  `task.gate_resolved`. O que a 12b precisa provar é a cadeia veredito → outbox
  → wake → claim, não se um 7B sabe ler uma suite.

Uma validação que fingisse cobrir mais do que cobre seria pior que a ausência
dela: daria por fechado o que não foi exercitado.

**O `NoopDevAgentServer` entrou na máquina de estados da 12b — e isso foi um
achado da própria preparação da validação.** A Fase 12b mudou só o
`DevAgentServer` real. O Noop continuava fixando `status: :working`, sem assinar
o `Engine.Dev.Wake`, processando uma task e parando: **o achado #10 seguia vivo
dentro do único veículo capaz de validar a fase sem gastar token.** Uma execução
de ponta a ponta com ele teria reprovado o critério "zero restarts" por defeito
do instrumento, não do produto.

A correção não foi copiar a máquina para o Noop, e sim movê-la para
`Engine.Dev.AgentIo` — o módulo que já existia justamente porque "um Noop que
reimplementasse essas partes validaria uma cópia, não a infraestrutura". O
argumento valia para worktree e identidade de commit desde a Fase 4a; passou a
valer para o reagendamento. O que difere entre os dois agentes é `run_task`, e
só ele, então ele entra como função e não como behaviour.

**A colheita da Fase 10 foi escrita agora, com os buracos declarados.**
`CLAUDE.md:77` referenciava `docs/explanation/primeiro-dogfooding.md` desde o
fim daquela fase, e o arquivo nunca existiu. Ele foi escrito do que é
reconstruível — os dezessete achados com arquivo e linha, a narrativa das tandas,
o seed manual — e **tudo que dependeria de contagem ao vivo entrou como
`não medido`**, jamais como estimativa. É a regra da própria colheita
(`colheita-esqueleto.md:22-24`): nenhum número entra sem uma consulta que o
produza.

Na tabela de contraste, "1 restart por task entregue" aparece como **propriedade
derivada do código de então**, não como média observada — a distinção está
escrita na própria célula.

## Consequências

A Fase 12 fecha com os três achados P1 de operabilidade resolvidos e provados
numa execução única. Os outros catorze continuam listados e abertos na colheita;
nenhum foi corrigido de passagem, pelo mesmo princípio que a missão da Fase 10
estabeleceu — corrigir um achado fora da fase que o endereça esconde a evidência
de por que ele existia.

Três coisas que esta fase revelou e que entram como **backlog, não conserto**:

1. **A instrumentação da métrica principal precede o experimento.** O achado #17
   (P1, aberto) diz que `proposed_action.approved`/`.denied` vão só para o
   outbox, nunca para `session_events`. A metade quantitativa da colheita da
   Fase 10 não existe em boa parte por causa disso. Um próximo dogfooding sem
   resolver o #17 antes vai perder os mesmos números de novo.
2. **Não existe ferramenta de editar história.** O loop de recusa da 12c fecha
   por recriação (`create_story`), e a história recusada fica em `draft` com o
   motivo gravado. É auditável, mas deixa resíduo no backlog. Está registrado no
   [ADR 0046](0046-promocao-de-story-com-autoridade-do-usuario.md).
3. **A cobertura do docmap tinha um vão exatamente onde esta fase mais mexeu.**
   Nenhuma regra observava `apps/engine/lib/engine/dev/**` nem
   `apps/engine/lib/engine/agents/**`: a máquina de estados dos dev agents e os
   agentes conversacionais podiam mudar sem doc nenhuma ser cobrada. Este ADR
   corrige o vão junto, porque deixá-lo aberto faria o próprio mecanismo de
   documentação mentir sobre a fase que o exercitou.

O que a Fase 12 **não** mudou, e vale dizer explicitamente porque é o eixo do
produto: o pipeline de aprovações está exatamente como estava, e merge em branch
protegida continua sendo decisão manual do usuário. O passo 6 da validação
propõe um merge com autonomia `auto_approve` e `permissions.json` liberando, e
exige `pending` como resultado. Reagendar o agente não é conceder autonomia — é
só ele não morrer entre tarefas.
