# 0139 — O alarme de merge de esteira ganha destinatário, e a regra de `dev`

## Context

A política diz, desde sempre, que promoção é `--no-ff`
([branching-policy.md](../explanation/branching-policy.md)): *"a squash would
flatten the lower step's commits, and the stage's tag would end up pointing to a
commit that no longer exists"*. A regra foi quebrada **três vezes** — #367
(2026-08-24), #394 (2026-08-25) e #464 (2026-09-04) — e a terceira foi a mais
cara de todas, porque era justamente o PR que consertava as duas primeiras.

O que se descobriu ao investigar não foi um buraco de detecção. Foi o oposto:

**A verificação existia e funcionou.** `tag-release` reprova merge em `qa` sem
segundo pai desde 2026-07-27, e o log do run de 2026-08-25 diz, com todas as
letras:

```
[tag-release] o merge em `qa` não é merge commit (1 pai)
##[error]o merge em `qa` não é merge commit (1 pai)
```

Ela tocou nas duas promoções squashadas. E o histórico ficou quebrado do mesmo
jeito, por 293 commits, até a promoção seguinte abrir com 11 arquivos em
"conflito" que não eram conflito — só ancestralidade perdida.

**O que faltou foi para QUEM tocar.** Workflow de `push` que falha numa
permanente não tem PR onde ficar vermelho: o merge já aconteceu. Sobra um run na
aba Actions, que ninguém abre porque nada avisa que ele existe. O repositório
tinha **zero issues** na história inteira — o canal não existia. Detecção sem
endereço é alarme tocando em sala vazia.

### Por que não simplesmente desligar o squash

Foi a primeira saída considerada, e ela é a única com garantia absoluta:
`allow_squash_merge: false` faz o botão deixar de existir. Foi **medida e
recusada**, com o número na mão: os seis merges mais recentes em `dev` são
squash de um pai só — squash *é* a convenção de PR de trabalho aqui —, e
`scripts/changelog.mjs` gera o CHANGELOG com `git log --no-merges`, contando com
isso: hoje um squash é uma linha; com merge commit, cada commit intermediário de
WIP viraria entrada. Desligar o squash conserta a promoção taxando todo PR de
trabalho e mexendo na geração do changelog. O problema é da esteira; a conta
seria paga pelo trabalho.

Fica registrado o que também não serve, para ninguém procurar de novo: **merge
queue** resolveria com método fixo por fila, e o CLAUDE.md a proíbe
explicitamente; e o controle nativo do GitHub por branch nesse espaço é
`required_linear_history`, que faz o **inverso** — proíbe merge commit. Não
existe "exigir merge commit" por branch.

## Decision

**1. O alarme ganha um job com destinatário.** `tag-release.yml` ganha `avisar`,
`if: failure()`, que abre uma issue nomeando branch, commit, run e o conserto —
e **comenta na issue já aberta** em vez de abrir uma segunda para a mesma
branch, porque enxurrada de issue idêntica é a forma mais rápida de ensinar
alguém a ignorá-las. O título é chave de deduplicação, fechado por teste
(`tituloDoAlarme`).

Ele autentica com `github.token`, **nunca com o PAT**: um `BRABO_BOT_TOKEN`
inválido é uma das falhas que ele precisa reportar (o `checkout` morre com
`could not read Username`), e alarme que depende do que pode estar quebrado é
alarme que cala exatamente na hora em que precisa tocar. O corpo vai por
`--body-file`, nunca interpolado num `run:` — o texto tem crases e `$`, e
interpolação de conteúdo dentro de `bash -e` é injeção.

**2. A regra passa a cobrir `dev`, e a cobertura é ESTREITA.** `dev` recebe
trabalho o tempo todo e por squash de propósito, então "um pai é defeito" não
vale ali — reprovaria todo PR. O que é defeito em `dev` é o PR que **trazia uma
aresta nova**: o head dele era um merge cujo segundo pai ainda não estava na
base. Foi a #464, cuja entrega inteira era essa aresta.

A distinção importa porque existe um vizinho quase idêntico e **benigno**: o PR
de trabalho que puxou `dev` para dentro de si antes de mergear também tem merge
por head — mas o segundo pai já está na base, e o squash não perde nada.

**3. A consulta que identifica o PR é por `merge_commit_sha`, e isso não é
estilo.** `gh api repos/{repo}/commits/{sha}/pulls` devolve **todo** PR
associado ao commit — e como `dev` é o head do PR de promoção que fica aberto o
ciclo inteiro, todo commit de `dev` vem associado a ele. Ler `.[0].head.ref`
devolveria `dev` (uma permanente) para qualquer squash de PR de trabalho, e a
regra reprovaria o repositório inteiro. O erro foi cometido e pego pela
verificação contra dados reais antes de subir; fica escrito para não voltar.

**4. `null` é resposta, e em `dev` ela não vira defeito.** Não conseguir saber
se havia aresta (API fora do ar, PR apagado, objeto ausente no clone) é
diferente de saber que não havia. Em `dev` isso passa, porque a taxa-base é
trabalho legítimo. Em `qa`/`main` não muda nada: ali só entra esteira, e um pai
é defeito com ou sem origem conhecida. É deliberadamente o **inverso** da
doutrina do `promotion-check` ("verificação impossível conta como reprovada") —
lá o universo é só promoção, aqui não.

## Consequences

**Isto não previne, e a distinção é o ponto.** O método é escolhido no clique;
prevenir de verdade exigiria uma das duas saídas recusadas acima, ou tirar o
merge da mão do humano — o que esbarra na regra do CLAUDE.md de que merge em
branch protegida é sempre manual. O que muda é o tempo de descoberta: de "no
próximo ciclo de promoção" para "um minuto depois, numa issue com dono", quando
reverter ainda é trivial.

**A prevenção continua em aberto, e é decisão de produto.** A saída que resolve
sem taxar o trabalho é o `promote.yml` — que já existe, já é `workflow_dispatch`
e já tem o par da esteira como input — passar a executar o `git merge --no-ff`
ele mesmo. Isso preserva a autoridade (nada mergeia sem um humano disparar) e
mecaniza só o método, mas exige decidir se dispatch humano conta como "merge
manual" no sentido do CLAUDE.md, e abriria uma terceira exceção ao "nunca push
direto em permanente". Não foi tomada aqui.

**Verificado contra dados reais, não por raciocínio.** A regra foi rodada contra
os três commits que a motivaram: reprova `bf6db00c9` (o squash da #464) e aprova
`1eb71c322` e `108d81cc7` (PRs de trabalho normais) — sem falso positivo.

**Achado no caminho, e fora do alcance deste ADR:** o `BRABO_BOT_TOKEN` está
inválido ou expirado desde 2026-09-03 à noite, e por isso **nenhuma tag está
sendo carimbada em branch nenhuma** — o `checkout` do `tag-release` falha antes
de qualquer lógica. Só a rotação do segredo resolve, e ela é `TODO(humano)`.
Registrado no CLAUDE.md.
