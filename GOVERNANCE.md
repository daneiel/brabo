# Governança

Este documento resolve um `TODO(humano)` que
[branching-policy.md](docs/explanation/branching-policy.md#migração-para-modo-community)
deixava em aberto desde o ADR 0030: o critério de quem entra em cada lista de
aprovadores do modo `community` do `approval-ladder` — quem entra, quem sai, e
com base em quê. Até esse critério existir em algum lugar, migrar de `solo`
para `community` seria decisão sem regra escrita por trás.

É **proposta**, não um comitê que já existe: hoje o projeto tem um mantenedor
só, e a maior parte deste documento descreve o que passa a valer **quando**
isso mudar, não uma estrutura já em funcionamento.

## Modelo hoje: mantenedor único

O projeto é mantido por [@daneiel](https://github.com/daneiel) sozinho.
Decisão técnica, de produto e de release é dele — é o que
[branching-policy.md](docs/explanation/branching-policy.md#modo-solo--o-que-vale-hoje)
chama de modo `solo`: uma aprovação do owner para PR de terceiro, e o merge
manual do próprio owner faz as vezes de aprovação no PR dele mesmo (a
plataforma não permite aprovar o próprio PR pela interface).

Isso não é modelo provisório por descuido — é o modelo **honesto** para um
projeto com uma pessoa. A escada de três papéis abaixo só faz sentido quando
existir gente de verdade para preenchê-la; até lá, ativá-la produziria uma
regra que ninguém consegue cumprir.

## Os três papéis do modo `community`

Quando `APPROVAL_MODE=community`, a exigência de aprovação por destino
(`docs/explanation/branching-policy.md#modo-community--quando-houver-gente`) é:

| destino | exige |
|---|---|
| `dev` | 1 aprovação de **devs** |
| `qa` | 2 aprovações de **devs**, pessoas distintas |
| `main` | 1 aprovação de **po** **+** 1 de **gestão**, pessoas distintas |

Os papéis são listas de handles em variáveis de repositório
(`APROVADORES_DEVS`, `APROVADORES_PO`, `APROVADORES_GESTAO`) — não Times do
GitHub, pelo motivo já registrado em `branching-policy.md`: este repositório
pertence a um usuário, não a uma organização.

### `devs`

Aprova mudança de código em `dev` e `qa`.

- **Critério de entrada:** contribuição sustentada — várias PRs mergeadas que
  mostrem familiaridade real com as decisões registradas nos ADRs e com as
  convenções deste `CLAUDE.md`/`CONTRIBUTING.md`. Não é contador fixo de PRs;
  é o mantenedor reconhecendo que a pessoa já entende o suficiente do produto
  para julgar o PR de outra pessoa, não só o próprio.
- **Quem decide:** o mantenedor atual convida — não há auto-indicação.
  Enquanto o modelo for `solo`, é a mesma pessoa que decide tudo; a diferença
  aparece quando houver mais de um mantenedor de fato.
- **Critério de saída:** pedido da própria pessoa, inatividade prolongada (sem
  contribuição nem review em 6 meses), ou violação do
  [Código de Conduta](CODE_OF_CONDUCT.md) apurada pelo canal que ele descreve.

### `po`

Aprova o que chega em `main` do lado de **direção de produto** — o que o
Brabo faz, para quem, e por quê.

- **Critério de entrada:** ser a pessoa que de fato responde por essas
  decisões fora do código — hoje ninguém além do mantenedor. Este papel só
  ganha um segundo nome quando houver alguém realmente dono dessa
  responsabilidade, não como reconhecimento simbólico.
- **Quem decide:** o mantenedor atual.
- **Critério de saída:** o mesmo da lista `devs`, mais deixar de exercer a
  responsabilidade de produto que justificou a entrada.

### `gestão`

Aprova o que chega em `main` do lado **organizacional** — release, prioridade
entre iniciativas, e a mesma característica do papel `po`: hoje é uma lista
vazia em qualquer cenário realista de curto prazo, e só ganha gente quando o
projeto tiver estrutura organizacional de verdade por trás.

- **Critério de entrada e saída:** os mesmos do papel `po`, aplicados à
  responsabilidade organizacional em vez de produto.

## Pessoas distintas em `main`

`branching-policy.md` já documenta por que a exigência de pessoas distintas em
`main` não é só contar aprovações — é um problema de atribuição, resolvido por
backtracking no `approval-ladder.ts`. A consequência de governança direta
disso: **a mesma pessoa não deveria estar, ao mesmo tempo, nas listas `po` e
`gestão`** — mesmo que o check aceitasse (não aceita, por desenho), teria
uma pessoa só decidindo os dois lados do que deveria ser checagem cruzada.

## Quando a migração para `community` acontece

Pré-requisito, além dos técnicos que `branching-policy.md` já lista (cada
papel com gente real, `qa` com dois `devs` distintos): os critérios de entrada
e saída deste documento precisam ter sido aplicados de verdade pelo menos uma
vez — ou seja, a primeira pessoa em cada lista tem que ter sido convidada
seguindo o critério acima, não populada só para o check parar de reprovar.

A decisão de migrar continua sendo do mantenedor atual. Este documento não
muda quem decide isso — só o critério de quem entra em cada papel quando ele
decidir que é hora.

## Autoridade final

Mesmo com o modo `community` ativo, o [merge em branch protegida continua
manual](CLAUDE.md) e a trava é garantida por teste — nenhum papel, incluindo
`gestão`, automatiza esse ato. A escada de aprovação decide quem PODE
aprovar; quem aperta o botão do merge continua sendo decisão humana,
sempre.

## Revisão deste documento

Mudança de critério aqui é, ela mesma, uma decisão do mantenedor atual — não
precisa de aprovação de ninguém que este documento ainda não descreve como
apto a aprovar. `docs/.docmap.yml` cobra revisão (`aviso`, não bloqueio) deste
arquivo quando `scripts/ci/approval-ladder.ts` ou
`docs/explanation/branching-policy.md` mudam, para o critério não envelhecer
em silêncio enquanto o mecanismo evolui.
