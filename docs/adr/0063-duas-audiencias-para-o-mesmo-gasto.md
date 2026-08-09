# ADR 0063 — Duas audiências para o mesmo gasto: a fatura do owner e o consumo do membro

- **Status:** aceito
- **Data:** 2026-08-09
- **Contexto anterior:** [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
  (o preço congelado em `token_usage`, que é o que torna qualquer relatório
  reproduzível), [RN-058](../business-rules.md#rn-058) (a chave que o agente
  gasta é a do owner) e [RN-060](../business-rules.md#rn-060) (o gasto das
  chaves é do owner, e só ele vê)

## Contexto

O pedido era uma aba de resumo de gastos, no espírito da tela de *activity* do
OpenRouter, mas falando dos providers, do owner e dos agentes deste produto. A
decisão de quem vê o quê veio junto e é do usuário: **o owner vê tudo do
workspace; o membro vê só o próprio consumo.**

O dado nunca foi o problema. `token_usage` tem tudo em coluna desde a Fase 9 —
provider, modelo, ator, tokens, custo, origem do binding, latência, e o preço
que produziu o custo, congelado no instante da chamada pelo
[ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md). O que faltava eram as
**agregações**: existiam cinco, todas por agente ou por provider×mês, e nenhuma
por modelo, por projeto dentro do workspace, por sessão ou por pessoa.

A dificuldade está em outro lugar, e é uma colisão entre duas regras que o
produto já tinha:

- pela **RN-058**, a chave de LLM que qualquer agente gasta é a do **owner do
  workspace**. Um membro rodando um agente gasta a credencial de outra pessoa;
- pela **RN-060**, o relatório desse gasto é do owner **e só dele**, com
  `@RequireRole('owner')` na rota. Não é `maintainer`: a fatura do dono não é
  assunto de quem opera um projeto.

Juntas, elas fazem "quanto EU gastei" ser, literalmente, um pedido de fatia da
fatura de outra pessoa. Duas saídas fáceis existiam, e as duas são erradas:

1. **abrir o relatório de credencial ao membro**, filtrando as linhas dele.
   Isso revoga a RN-060 pela porta dos fundos — a resposta continuaria falando
   de provider e de chave, que é exatamente o que a regra reserva ao dono, e
   bastaria o membro somar as linhas para reconstruir a conta;
2. **não mostrar nada ao membro**. Também é errado, e por um motivo prático: o
   consumo dele existe, está registrado com o nome dele em `token_usage`, e a
   única pessoa que não pode vê-lo seria justamente ele.

## Decisão

**As duas audiências recebem relatórios diferentes porque fazem perguntas
diferentes. Nenhum dos dois é um recorte do outro.**

**A RN-060 continua governando o relatório por CREDENCIAL.** `GET
/workspaces/:id/credential-spend`, o `GetCredentialSpendUseCase` e o
`CredentialSpendSection` ficam como estão: agrupados por **provider**, que é a
unidade da chave, exigindo `owner`, e respondendo à pergunta da **fatura** —
"quanto saiu da minha chave da OpenRouter este mês". A aba nova o **reaproveita
inteiro** em vez de reescrevê-lo.

**A visão do membro é por ATOR**, em tokens e custo **estimado**, e **não quebra
por provider nem por credencial**. `GET /projects/:id/spend/me` devolve o
consumo de quem chamou, por sessão e por dia, dentro de um projeto. O ator sai
do **token autenticado**, e o caso de uso não expõe forma de perguntar por
outro: não existe parâmetro onde escrever o id de outra pessoa. "Membro não vê
linha de outro ator" é uma propriedade da assinatura, não uma checagem que
alguém pode esquecer de chamar.

**Agente não entra na conta do membro.** `token_usage` registra **quem gastou**,
não quem mandou gastar; atribuir um agente a quem o iniciou seria inventar um
dado que a tabela não tem. O que os agentes gastam aparece no relatório do
owner, que é de quem é a chave.

**O eixo de provider não existe na agregação nova.** As cinco dimensões novas
(`model`, `project`, `actor`, `session`, `day`) vivem num método só do
repositório, `sumGroupedBy(dimensao, escopo)`, e `provider` **não é uma delas**.
A ausência é estrutural, não um esquecimento: quebrar gasto por provider é
quebrar por credencial, e é assim que a visão do membro fica impedida de ganhar
esse eixo por descuido — não há argumento a passar. Pelo mesmo motivo, dois
providers servindo o **mesmo nome de modelo** caem numa linha só na dimensão
`model`: separá-los reintroduziria o eixo de credencial com outro nome.

**O owner vê as duas coisas** — a quebra do workspace por modelo, projeto, ator
e dia, e a fatura por credencial logo abaixo — porque ele é a única pessoa que
pode ver as duas. A tela nunca dispara a rota de owner sem o papel: pedir um 403
de propósito é ruído no log de segurança.

**Sem biblioteca de gráficos.** São duas formas, uma série cada: barras por dia
(magnitude discreta — uma linha sugeriria gasto contínuo entre dois dias, que
não existe) e barras horizontais de ranking. `<rect>` e `<span>` em SVG inline e
CSS cobrem, e uma dependência de gráficos aqui seria peso de runtime por uma
geometria que cabe em dez linhas. A série diária vem **densa** da api: dia sem
gasto entra com zero, senão três chamadas em três semanas viram três barras
coladas, indistinguíveis de três dias seguidos de uso.

## Consequências

**A pergunta do membro fica declaradamente incompleta, e é o preço certo.** Ele
vê o próprio chat e não vê os agentes que rodou. Enquanto a chave for a do owner
(RN-058), qualquer número "de agente" mostrado ao membro seria gasto de outra
pessoa com o nome dele em cima. Se um dia o produto tiver credencial por pessoa,
esta decisão precisa ser revisitada — e será por um ADR novo, não editando este.

**São duas rotas e não uma com ramificação por papel.** Um único endpoint que
mudasse de forma conforme quem chama teria dois contratos com o mesmo nome, e o
teste de superfície (`docs/security-surface.md`) classificaria uma rota só com o
papel mais permissivo — perdendo justamente a distinção que este ADR existe para
manter.

**A dimensão `model` mistura providers.** Quem quiser saber por onde um modelo
foi servido não descobre aqui, de propósito. `upstream_provider` continua na
tabela para quem precisar investigar caso a caso.

**Nenhuma migration, e nenhum índice — ainda.** `token_usage` tem só a PK, e as
duas consultas fazem *seq scan*. Medido com 525 mil linhas no banco de teste
isolado: o relatório do workspace sai em **55 ms** e o do membro em **38 ms**.
Com um índice em `token_usage(created_at)` os mesmos planos viram *bitmap heap
scan* e caem para **32 ms** e **19 ms**. O ganho é real e o índice é barato, mas
o slot de migration desta onda é de outra fase; ele entra depois, com a medição
já feita e registrada aqui. O que muda a conta é volume: as duas consultas leem
a janela inteira, e o custo cresce com o tamanho de `token_usage`, não com o do
pedido.

**A janela é deslizante e tem teto (180 dias, padrão 30).** Um relatório sem
teto seria um convite a varrer a tabela inteira por query string, e a lição do
`429` que virava tela branca (RN-088/RN-090) é recente demais para ignorar.

**O custo mostrado ao membro é estimado, e a tela diz isso.** Ele vem do preço
congelado no instante da chamada (ADR 0042), que é o melhor número que existe —
mas a fatura que chega ao owner é do provider, e nunca prometemos que os dois
batem ao centavo.

**Fica de fora, declarado:** moeda e taxa de câmbio (backlog, e converter com
taxa inventada seria pior que dólar honesto), gasto por área (cortado desde o
ADR 0038 — os tetos reais continuam em projeto, sessão e task) e qualquer
exportação. A aba **lê**: não há verbo de escrita nela, e é a ausência de verbo
que torna essa fronteira verificável.
