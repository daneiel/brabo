---
sidebar_position: 8
---

# Backlog triado

Saída da **FASE 13c**. Reúne os achados abertos da execução real
([achados-execucao-real.md](achados-execucao-real.md)) e os itens antigos que
viviam espalhados por ADRs e pelo CLAUDE.md.

> É **proposta**. A classificação e o agrupamento abaixo são um argumento sobre
> o que custa mais esperar; a decisão de prioridade é do usuário.

## Como está classificado

**P1** — bloqueia o produto de fazer o que ele promete. **P2** — o produto faz,
mas mente ou confunde quem olha. **P3** — qualidade, sem quem esteja preso.

**Custo**: P (uma sessão), M (uma fase pequena), G (fase própria, com ADR).

**Risco de esperar** é a coluna que decide empate: um defeito que corrompe dado
ou apaga evidência custa mais tarde do que hoje; um cosmético custa igual.

## O quadro

| fase proposta | itens | prio | custo | risco de esperar |
|---|---|---|---|---|
| A — Destravar a task | ADR 0052, O/B | **P1** | M | **alto** — nada a jusante roda |
| B — Engine em provider remoto | N | **P1** | G | alto — a 13b não fecha como escrita |
| C — A UI não pode mentir sobre agentes | C, I, H, L, G | P2 | M | médio |
| D — Wizard sem beco sem saída | D | P2 | P | baixo |
| E — Qualidade do que os agentes produzem | K, R, J | P3 | M | baixo |
| — avulso | promotion-check sem spec | P3 | P | baixo |

O resto (itens antigos) está em [Backlog anterior](#backlog-anterior), sem
prioridade atribuída: são decisões de produto, não defeitos.

---

## Fase A — Destravar a task (P1)

**Nenhum dev agent jamais terminou uma task.** É o fato que ordena tudo: o
registro de gates da FASE 15a mostra `qa-verificada`, `secops-segura` e os dois
de infra como *"nunca passou"* — não por falta de execução, mas porque nunca
existiu PR para gate nenhum julgar.

| item | o que é |
|---|---|
| **ADR 0052** | aprovação pendente devolve `status pending` como resultado da ferramenta e queima uma iteração; o agente morre no teto sem escrever nada. Cinco peças mapeadas, desenho fechado, e o padrão já existe (`pr_settled`) |
| **O / B** | sessão e dev agents nascem no `llama3.2:1b` local, que o ADR 0020 proíbe no passo semântico. Tive de trocar à mão em toda sessão desta rodada. Desenho já decidido: modelo de start configurável, herdando o do Criativo |

Por que juntas: destravar o laço sem resolver o modelo entrega um agente que
consegue trabalhar e escreve mal. As duas juntas são a primeira task completa.

**Risco de esperar: alto.** Enquanto isso não fecha, PR remota, gates de
QA/SecOps e a medição da 13b ficam represados atrás — e cada rodada de
dogfooding gasta dinheiro para reconfirmar o mesmo bloqueio.

## Fase B — Engine em provider remoto (P1)

**N** — `get_local_repo_path/1` devolve `{:error, {:unsupported_provider, "github"}}`
para tudo que não é `local`. Cinco call sites dependem dele: worktree do dev,
executor de terminal, o diff que QA e SecOps leem, e o contexto de projeto.

A assimetria é a chave: a **api** fala GitHub por HTTP (criou o repo, commitou,
criou as branches); o **engine** trabalha no sistema de arquivos e só conhece
bare repo local. Projeto no GitHub faz a metade conversacional e o bootstrap,
mas não a metade de construção.

Custo **G**: exige clone, credencial dentro do engine e push — feature com ADR.

**Depende da Fase A?** Não tecnicamente, mas fazer B antes de A é pagar o caro
para continuar esbarrando no barato: o agente chegaria ao worktree remoto e
morreria no mesmo teto de iterações.

## Fase C — A UI não pode mentir sobre agentes (P2)

Cinco itens com a mesma raiz: a tela conta uma história diferente da do event
log.

| item | o que a tela faz |
|---|---|
| **C** | a bolha ao vivo vem rotulada com o **modelo**; o agente só aparece quando o evento persistido chega — e a mensagem fica duplicada até o reload |
| **I** | trocar o modelo da sessão reescreve retroativamente o rótulo de ações antigas |
| **H** | os eventos do bootstrap aparecem todos como "atividade em system" |
| **L** | o botão do rodapé continua "Estou pronto para produzir" depois do handoff |
| **G** | o convite do Criativo não aparece em projeto criado, porque o fio já tem os cards do bootstrap |

**C** é o mais grave dos cinco e foi apontado por você durante a execução: quem
fala é o agente, o modelo é detalhe de execução.

**Risco de esperar: médio.** Não corrompe dado, mas ensina errado — quem usa o
produto aprende a desconfiar da tela, e aí para de reportar defeito de verdade.

## Fase D — Wizard sem beco sem saída (P2, custo P)

**D** — `Proteger branches` falha em repo privado no plano gratuito, e o próprio
wizard **avisa isso antes**. Mas a única ação oferecida depois é "Tentar
novamente", que vai falhar sempre. Falta reconhecer e seguir.

Pequeno e isolado; pode entrar como carona de qualquer fase de UI.

## Fase E — Qualidade do que os agentes produzem (P3)

| item | o que acontece |
|---|---|
| **K** | rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs — sem dedupe nem aviso |
| **R** | o PO gerou duas histórias cobrindo o mesmo endpoint |
| **J** | o Psicólogo roda em sessão recém-aberta com as hipóteses da anterior e o log vazio, tenta citar eventos inexistentes e desiste |

São problemas de prompt e de validação de artefato, não de mecanismo. **J** tem
o consolo de que a validação de evidência segurou a invenção — o desperdício é
de dinheiro, não de verdade.

## Avulso

**`promotion-check` sem spec própria** — é check required, ao contrário de
`pr-police` e `approval-ladder` que têm teste. Encontrado ao escrever o registro
de gates (FASE 15a, PR #145). Custo P.

---

## Backlog anterior

Itens que já existiam antes desta rodada. Não são defeitos, são decisões de
produto adiadas — por isso sem prioridade aqui.

| item | onde foi decidido |
|---|---|
| Budget por área | corte da Fase 8; o aparato de áreas saiu do backlog com o [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md) |
| Dev Lead e áreas via `module_map` | **saiu do backlog**: ADR 0053, implementado pela FASE 14d |
| Handoff manual a agente à escolha | — |
| MFA, login social, OIDC, federação | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) |
| SMTP real no MailSender | hoje é log-only |
| Deploy (`DEPLOY_ENABLED` + Environments) | o gate `operavel` já está declarado como `planned` |
| Volta da `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| Modo community do approval-ladder | vira mudança de `aprovacao_humana` no registro de gates (ADR 0054, PR #145) |
| "N agentes online" no dashboard | — |
| Preferência de moeda com taxa manual | — |
| FASE 15b — painel lendo o registro de gates | metade restante da FASE 15 |

## O que esta triagem NÃO faz

Não corrige nada. A disciplina que vem valendo desde a Fase 10 continua: cada
achado espera a fase que o endereça, e corrigir fora dela apaga a evidência de
por que ele existia.

E não inventa prioridade onde não há dado: os itens do backlog anterior não
receberam P1/P2/P3 porque a decisão deles é de produto, não de engenharia — e
palpite vestido de classificação seria pior que a lista crua.
