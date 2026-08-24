# ADR 0076 — `provider` volta a ser dimensão de gasto, e a contenção passa a ser do tipo

- **Status:** aceito
- **Data:** 2026-08-14
- **Revisa:** [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) (as duas
  audiências do mesmo gasto), que excluiu `provider` das dimensões de
  propósito
- **Contexto anterior:** [RN-058](../business-rules.md#rn-058) (a chave que o
  agente gasta é a do owner), [RN-060](../business-rules.md#rn-060) (o gasto
  das chaves é do owner, e só ele vê) e
  [RN-101](../business-rules.md#rn-101) (as duas audiências)

## Contexto

O [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) deixou `provider` fora
das dimensões de `sumGroupedBy` com uma frase sem meio-termo: *"a ausência é
estrutural, não um esquecimento: quebrar gasto por provider é quebrar por
CREDENCIAL, e é assim que a visão do membro fica impedida de ganhar esse eixo
por descuido — não há argumento a passar"*. O tipo carregava o mesmo aviso em
comentário: *"Os cinco recortes do relatório de gasto. Nenhum deles é
provider."*

O dono do produto decidiu **reabrir a dimensão**, ciente da consequência. Este
ADR não existe para dizer que o 0063 errou — o argumento dele continua correto,
e é justamente por ele que a reabertura precisa vir com a contenção escrita.

O que a decisão de 2026-08-09 não separava, e o uso pediu:

- **o owner não consegue ver, na janela deslizante, por onde o dinheiro saiu.**
  `credential-spend` responde por provider, mas em MESES-calendário e amarrado
  à credencial que existe hoje. Perguntar "nestes 30 dias, quanto foi OpenRouter
  e quanto foi Anthropic" exigia ler dois relatórios com janelas diferentes e
  somar à mão;
- **pessoa e agente vinham no mesmo ranking.** A lista `porAtor` mistura os
  dois, distintos só por um campo, e o handoff de design pede dois blocos.

## Decisão

**`provider` volta a ser `SpendDimension`, e o relatório do owner ganha
`porProvider`** ([RN-186](../business-rules.md#rn-186)). O eixo mora numa rota
que já exigia `owner` — a mesma régua da RN-060 —, e o membro não ganha campo
nenhum. `credential-spend` fica **intocada**: ela responde a fatura por mês, com
o vínculo à chave que existe hoje (`temCredencial`), e o eixo novo responde o
gasto por provider DENTRO da janela, ao lado de modelo, projeto e ator. Não é
recorte uma da outra, pelo mesmo critério que o 0063 usou para separar as duas
audiências.

**A contenção da privacidade muda de forma, não de força: quem contém agora é o
TIPO** ([RN-187](../business-rules.md#rn-187)). `sumGroupedBy` tem duas
sobrecargas, e o que as separa é o escopo:

```ts
abstract sumGroupedBy(d: SpendDimensionDoAtor, e: SpendScopeDeAtor): Promise<SpendBucket[]>;
abstract sumGroupedBy(d: SpendDimension,       e: SpendScopeAmplo): Promise<SpendBucket[]>;

export type SpendDimensionDoAtor = Exclude<SpendDimension, 'provider'>;
```

Um escopo que carrega `actor` — a visão do membro, e o único escopo que ela tem
— só aceita `SpendDimensionDoAtor`. `sumGroupedBy('provider', escopoComAtor)`
**não compila**. Os dois escopos são mutuamente exclusivos por construção
(`SpendScopeAmplo` declara `actor?: undefined`), então a sobrecarga certa é
escolhida sem ninguém precisar dizer qual.

**Nenhum `if` sobre essa combinação**, nem no repositório nem no caso de uso, e
a ausência é deliberada: uma checagem em tempo de execução daria a impressão de
que a garantia é dinâmica, quando quem a sustenta é o compilador — e um `if` é
exatamente o que a próxima refatoração remove sem deixar nenhum teste vermelho.
É o mesmo raciocínio da RN-153/154, em que a resolução do "auto mode" mora no
repositório e `decide.ts` não ganhou uma linha: garantia por construção vale
mais que garantia por vigilância.

**`Exclude` em vez de uma segunda lista escrita à mão.** Dimensão nova nasce
alcançável pelas duas audiências, e tirá-la do alcance do membro passa a ser um
ato explícito **naquele ponto** — nunca um esquecimento em outro arquivo. A
alternativa (duas listas independentes) tem um modo de falha conhecido: a lista
restrita envelhece calada.

**Pessoa e agente viram dois blocos, derivados e não consultados**
([RN-188](../business-rules.md#rn-188)). `porOwner` e `porAgente` são partição
de `porAtor` por `actor_kind`, feita no caso de uso; `porAtor` continua inteira
para quem já a consumia. O 0063 mediu que o custo destas consultas cresce com o
tamanho de `token_usage` e não com o do pedido — varrer a janela duas vezes a
mais para separar o que já está separado em memória seria caro pelo motivo
errado.

**O índice em `token_usage(created_at)` entra agora** (migração `0044`). O 0063
mediu e deixou registrado: a 525 mil linhas, 55 ms e 38 ms por *seq scan*, 32 ms
e 19 ms com o índice. Faltava só o slot de migration.

**A dimensão `model` não muda.** Dois providers servindo o mesmo nome de modelo
continuam numa linha só. Agora existe a lista por provider ao lado; cruzar as
duas dimensões multiplicaria as linhas do ranking sem responder pergunta que as
duas listas separadas já não respondam.

## Consequências

**A frase mais dura do 0063 deixou de valer, e é honesto dizer qual.** "Não há
argumento a passar" era uma garantia de superfície de API: nenhuma assinatura
aceitava a palavra `provider`. Hoje uma assinatura aceita, e a garantia depende
de o chamador do lado do membro estar tipado com `SpendScopeDeAtor`. Ele está —
`GetMySpendUseCase` declara o tipo explicitamente, e não o infere, por essa
razão —, mas a diferença é real: passamos de "impossível de expressar" para
"impossível de compilar". A segunda é mais fraca que a primeira, e é o preço
aceito pela decisão do dono do produto.

**O que segura o preço são duas barreiras independentes.** A rota do membro
**não tem parâmetro de dimensão** (`projectId` e `dias`, e nada mais), então
`?dimensao=provider` é descartado pelo Nest antes de o handler existir. A
primeira barreira já bastava; a segunda existe para que ela continue bastando
depois da próxima mudança. As duas têm teste, e o do tipo é um
`@ts-expect-error` — se a barreira cair, o `tsc` reprova a linha por diretiva
NÃO USADA, em vez de o teste passar a testar nada.

**Quem pode ver credencial não mudou.** `owner` nas duas rotas que falam de
provider; `viewer` na do membro, que não fala. A classificação em
`docs/security-surface.md` é a mesma — nenhuma rota nasceu, nenhuma mudou de
papel —, e é por isso que o eixo novo não afrouxa a superfície exposta.

**"Por owner" é o rótulo do handoff, e o bloco é de PESSOAS.** `porOwner` traz
toda linha de `actor_kind = 'user'`, não só as do dono do workspace; o rótulo se
sustenta porque, pela RN-058, é a chave do owner que todas elas gastam. Quem é o
dono continua sendo o campo `ownerId`. Se um dia houver credencial por pessoa,
este bloco precisa de nome novo — e o mesmo vale para a RN-101 inteira, como o
0063 já previa.

**`actor_kind` que não é pessoa nem agente fica fora dos dois blocos.** Hoje é
só `system`, que continua em `porAtor` e no total. Abrir um terceiro bloco diria
que o produto tem uma audiência que ele não tem; escondê-lo do total seria
mentir sobre o gasto.

**Fica de fora, declarado:** a TELA. Esta mudança é só backend — `porProvider`,
`porOwner` e `porAgente` chegam ao cliente pelos tipos de `apps/web/src/lib`, e
nenhum componente os desenha ainda. Continuam fora, do 0063: moeda e taxa de
câmbio, gasto por área e qualquer exportação.
