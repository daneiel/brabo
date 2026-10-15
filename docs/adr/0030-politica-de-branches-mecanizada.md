# 0030 — Política de branches mecanizada

## Contexto

A política de branches do Brabo existia como apresentação e como convenção no
`CLAUDE.md`: esteira `dev → qa → main`, taxonomia de branches, promoção só entre
degraus vizinhos, versão calculada, hotfix voltando por retropropagação.

Convenção escrita não é mecanismo. Enquanto a regra mora só no documento, ela
depende de todo mundo lembrar dela na hora errada — e a hora errada é sempre a
de incidente, às 3h da manhã, quando lembrar é justamente o que não acontece.
Pior: uma regra que ninguém verifica não tem como ser violada *visivelmente*.
Ela é violada em silêncio, e o sintoma aparece meses depois, longe da causa.

A FASE 6 mecanizou a política inteira no próprio repositório do Brabo. Este ADR
fecha a fase: mapeia **regra → mecanismo**, registra o que foi cortado com o
custo de reintroduzir cada corte, e separa o que disso vira template para o
bootstrap de Gitflow do produto — que é fase futura, não código agora.

Duas restrições moldaram tudo. A primeira: **este é um repositório de usuário,
não de organização.** Times do GitHub não existem aqui, e o `GITHUB_TOKEN` não
lê membership de time nem em organização. A segunda: **o produto não pode ser
tocado nesta fase.** A FASE 6 é CI/CD do repositório; o que ela ensina ao
produto vira este ADR, não código.

## Decisão

### Regra → mecanismo

| regra da política | mecanismo | onde a lógica vive |
|---|---|---|
| nome `funcao/descritivo`, regex `^.{0,15}/\S{0,32}$` | check `pr-police` | `scripts/ci/pr-police.ts` |
| prefixo na lista fechada de 9 funções | `pr-police` | idem |
| trabalho nasce de `dev`, `hotfix` de `main` | `pr-police`, por **contaminação** | idem |
| destino coerente com a função | `pr-police` | idem |
| promoção só entre degraus vizinhos | `pr-police` + `promote` | `pr-police.ts`, `version.ts` |
| label de família em todo PR | `pr-police` | idem |
| aprovação exigida por destino | check `approval-ladder` | `scripts/ci/approval-ladder.ts` |
| dois modos de aprovação por variável | `approval-ladder` | idem |
| pessoas distintas em `main` | emparelhamento por backtracking | idem |
| versão pelo maior impacto do ciclo | `promote` + `tag-release` | `scripts/ci/version.ts` |
| `N` incrementa por reprovação | contagem das tags existentes | idem |
| final ancorada na última `-qa.N` | `tag-release`, por **árvore + pai** | idem |
| hotfix gera PATCH sem âncora | `tag-release`, pelo **segundo pai** | idem |
| push direto bloqueado | rulesets | `docs/reference/rulesets.md` |
| retropropagação obrigatória e ordenada | check `backmerge-gate` | `scripts/ci/gate.ts` |
| merge em permanente é sempre manual | ausência de mecanismo, por decisão | — |

Toda lógica é **script testável**; workflow é casca fina que lê ambiente e
chama o script. São 149 testes cobrindo caminho felizes e casos de falha.

### As sete lições que valeram mais que o código

Elas estão aqui porque cada uma custou uma descoberta empírica, e nenhuma está
óbvia em documentação de terceiros.

**1. Cada família de gatilho lê o workflow de um lugar diferente.**
`pull_request` e `push` leem da branch do evento; `pull_request_target` e
`workflow_dispatch`, da branch **padrão**. Com `pull_request_target` o
`pr-police` teve **zero execuções** — a `main` estava 65 commits atrás. É
ovo-e-galinha: o check que faz a esteira andar precisa já estar na `main` para
poder rodar.

**2. Tag e PR criados com o `GITHUB_TOKEN` não disparam workflow.** Regra contra
recursão. A Release da `v0.2.0` nunca publicou por isso, e um PR de
retropropagação sem check nunca ficaria verde — a cadeia travaria para sempre.
Daí o `BRABO_BOT_TOKEN`.

**3. "Não consegui verificar" nunca pode virar "está tudo bem".** O
`promotion-check` lia a configuração de merge com `gh api --jq` e comparava com
`'true'`. Quando o token não tem permissão, o comando **tem sucesso devolvendo
vazio** — e vazio não é `'true'`, então a verificação passava a reprovar por
motivo errado, ou pior, a aprovar. Hoje há três estados, e a impossibilidade
vira aviso enquanto a garantia real olha o fato consumado: o commit tem dois
pais.

**4. Igualdade de árvore é mais forte que igualdade de commit.** A âncora
comparava shas — impossível de satisfazer, porque `--no-ff` cria um commit novo.
Comparar **árvore** e exigir que a `-qa.N` seja **pai** é mais forte: se o outro
lado do merge tivesse trazido um arquivo, a árvore mudaria.

**5. Contaminação, não origem.** Descobrir de onde uma branch nasceu é
indecidível a posteriori: com `P ⊆ Q ⊆ head`, o argmin de distância escolhe a
permanente mais avançada contida, não a de origem. A pergunta certa é outra —
"esta branch carrega o topo de uma permanente mais avançada que a que ela
declara?" — e essa tem resposta.

**6. Isenção por autor, nunca por prefixo.** Isentar branches que começam com
`dependabot/` seria uma brecha aberta: qualquer um nomeia uma branch assim.

**7. Estado declarado tem que ser conferível.** O `.release/gate.json` viaja nos
PRs de retropropagação para `qa` e `dev`; uma promoção pode subir aquela cópia
velha de volta e ressuscitar uma trava sem hotfix por trás — travando o
repositório para sempre, porque não há retropropagação pendente que a resolva. O
check pergunta ao git se o hotfix já desceu e deixa cair travas satisfeitas.
`locked` é o registro da intenção; a contenção é a verdade.

### O que foi cortado, e o custo de voltar

| cortado | por quê | o que custa reintroduzir |
|---|---|---|
| degrau `rc` / UAT | sem ambiente e sem gente para exercê-lo, seria degrau cerimonial | criar a branch, uma linha em `ESCADA`, uma em `ESTAGIO_POR_BRANCH`, uma na escada de aprovação, e a ordem do gate ganha um degrau — a cadeia do hotfix passa a ser quatro PRs |
| taxonomia com `rcfix` | morreu com o degrau `rc` | entrada em `FUNCOES_DE_CORRECAO_ALTA` mais os testes de origem e destino |
| times do GitHub para papéis | repo de usuário não tem times, e o `GITHUB_TOKEN` não lê membership nem em org | papéis são listas de handles em variáveis; migrar para times exigiria a org e um token com `read:org` |
| deploy | passo que nunca roda apodrece: ninguém o testa, e no dia de ligar estará errado | workflow **próprio** disparado pela tag, mais os Environments — nada a religar aqui |
| GitHub Environments | idem | criar quando houver ambiente |
| `GOVERNANCE.md` | cortado na FASE DOC; o critério mora no `branching-policy.md` | escrever o arquivo e mover a seção de papéis para lá |

A escada de aprovação em modo `community` **não** foi cortada: está
implementada, testada e desligada por configuração. A diferença é deliberada —
código desligado por variável, com teste dos dois lados, é demonstrável hoje;
passo de pipeline desligado por variável não é.

### O que vira template do bootstrap do produto

O produto provisiona repositórios com Gitflow (FASE 2). O que a FASE 6 aprendeu
e que deve entrar nesse template, em fase futura:

| entra no template | não entra |
|---|---|
| a esteira e a taxonomia como **dados**, não código — o produto tem projetos com escadas diferentes | os workflows do Brabo copiados literalmente |
| o gate de retropropagação: é a regra que mais custa quando falta | o `BRABO_BOT_TOKEN` — cada repo precisa da sua credencial |
| versão calculada da tag, sem PR de bump | as listas de aprovadores deste repo |
| "não consegui verificar" como terceiro estado explícito nos gates | — |
| isenção de bot por autor | — |

O `GitProvider` já expõe `capabilities`, e o ADR 0028 registra que proteção de
branch **divirge entre providers**. O template terá de degradar: onde não houver
ruleset, a regra vira check e a mensagem diz o que não pôde ser garantido — em
vez de fingir garantia.

## Consequências

**A política deixou de depender de memória.** Nome errado de branch, promoção
pulando degrau, hotfix sem retropropagação e tag final desancorada são agora
falhas de check com mensagem que ensina, não descobertas tardias.

**A esteira foi exercitada de ponta a ponta, não só testada em unidade.**
`v0.1.0 → v0.2.0-dev.1..4 → -qa.1..3 → v0.2.0`, com uma reprovação encenada
entre os carimbos de `qa` para provar que o `N` conta sozinho. A final ancorou
na `-qa.3` com árvore idêntica.

**Um check required que nunca roda trava o PR para sempre.** É a consequência
mais incômoda: a lista de checks obrigatórios é agora um acoplamento entre o
ruleset (aplicado à mão) e os workflows (versionados). Job novo no CI ou entra
na lista de `rulesets.md`, ou fica de fora de propósito e alguém escreve por quê.
É por isso que o `backmerge-gate` não tem `if:` no job: veredito velho colado a
um sha que não rodou liberaria merge durante trava.

**O bypass do gate é do ator, não do caminho.** Rulesets do GitHub não
restringem bypass por path. Quem pode escrever `.release/gate.json` pode,
tecnicamente, escrever qualquer coisa em `main`. O que limita de fato é o
workflow e o histórico. Fica registrado como limitação da ferramenta.

**Aplicação de ruleset continua manual.** O repositório versiona a fonte
(`docs/reference/rulesets.md`); aplicar é ato do owner. Automatizar exigiria um
token com poder de mudar as próprias proteções — o que anularia o ponto delas.

**A concentração de papéis no owner está escrita, não subentendida.**
Responsável de release e plantão de hotfix são o owner enquanto
`APPROVAL_MODE=solo`. As duas atribuições reabrem na migração para `community`,
onde o fallback de plantão terá de ser exceção documentada, nunca burla.

**Nada do produto mudou.** Nenhuma linha de `apps/` foi tocada. O que a fase
ensinou ao produto está na tabela de template acima, e virou plano, não código.

Referências: ADR [0028](0028-protecao-de-branch-divergencia-entre-providers.md)
(divergência de proteção entre providers),
[0029](0029-sincronizacao-continua-da-documentacao.md) (o mecanismo de docs que
esta fase usa), e a política completa em
[branching-policy](../explanation/branching-policy.md).
