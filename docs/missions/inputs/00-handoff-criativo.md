# Insumo 0 — o texto de entrada da sessão 0 (Criativo)

Material operacional da Fase 10b. Este arquivo tem o **texto literal** para colar
no chat da primeira sessão, e os prompts de refino da sessão seguinte.

## Por que o Criativo, e não o PO

O plano original mandava um handoff direto ao PO com os insumos. Isso não é
possível, e a razão importa porque ela também explica o formato do texto abaixo.

O único caminho até o PO é o botão "Estou pronto para produzir", que só aparece
com o Criativo ativo — não existe handoff manual para um agente à sua escolha. E
mesmo que existisse, o PO sozinho não resolveria: uma story só chega a `ready`
com **ao menos uma regra de negócio vinculada**, cada `business_rule_id` é
validado contra um evento `artifact.business_rule` real, e o PO **não tem a
ferramenta** que emite esse artefato — só o Criativo tem.

Sem regra de negócio no log, nenhuma story fica `ready`; sem story `ready`,
nenhum dev pega task. Por isso o texto abaixo insiste tanto em regras: **elas são
o que destrava a execução inteira**, não enfeite de documentação.

Detalhe de mecânica: não existe upload nem anexo no produto. O único jeito de o
conteúdo dos insumos chegar ao agente é você **colar texto** na caixa de
mensagem.

---

## O texto para colar

Cole isto na primeira mensagem da sessão 0. Ele é longo de propósito — o Criativo
não tem acesso ao repositório, então o contexto precisa vir junto.

---

> Vamos definir o escopo de uma entrega de plataforma. O produto é o **Brabo**, e
> desta vez o cliente é o próprio time: vamos acrescentar dois **providers de
> git** ao sistema.
>
> **O que já existe.** O Brabo tem um contrato único de git provider com dez
> operações (`createRepo`, `getRepo`, `createBranch`, `protectBranch`,
> `commitFiles`, `listBranches`, `openPullRequest`, `mergePullRequest`,
> `getFileContent`, `commentOnPullRequest`), duas capabilities declaradas por
> provider (`protectBranch` e `pullRequests`), sete classes de erro normalizado,
> e uma suite de contrato única com 19 cenários que roda igual contra qualquer
> implementação. Hoje existem três providers: Local, GitHub e GitLab.
>
> **O que falta.** Dois providers novos:
>
> 1. **Bitbucket Cloud** — uma plataforma completa, como GitHub e GitLab. O
>    desafio é traduzir a API dela para o contrato: autenticação, identidade do
>    repositório, restrição de branch, estratégias de merge e o mapa de erro por
>    status. Nada disso deve ser adivinhado: cada semântica precisa ser conferida
>    na documentação oficial antes de virar código.
> 2. **Generic** — um servidor git qualquer, sem API de plataforma (Gitea, um
>    bare repo atrás de SSH, um Forgejo). Aqui o desafio é o oposto: declarar
>    **honestamente** o que não dá para fazer, e garantir que o sistema degrade
>    em vez de quebrar. O provider Local já é o precedente disso.
>
> **O que eu preciso de você nesta sessão.** Emita uma **regra de negócio** para
> cada afirmação abaixo que deva valer no produto. Elas são o contrato que o
> backlog inteiro vai referenciar, então prefira várias regras específicas a uma
> genérica:
>
> - capability declarada tem que bater com o comportamento: operação não
>   suportada é recusada explicitamente, nunca falha em silêncio;
> - o provider novo passa na suite de contrato existente sem escrever cenário
>   próprio;
> - semântica de plataforma não verificada na documentação oficial não vira
>   código — vira limitação declarada;
> - erro de vendor é traduzido para a taxonomia normalizada por status e
>   marcador, nunca por texto livre da mensagem;
> - o bootstrap de Gitflow degrada (não falha) quando o provider não suporta uma
>   capability;
> - a interface precisa deixar o usuário escolher os providers novos, senão eles
>   existem e ninguém alcança.
>
> Acrescente as que você achar que faltam — você conhece o produto.
>
> **Um requisito não-funcional obrigatório:** pelo menos uma parte deste escopo
> tem requisito de **performance**. A suite de contrato roda contra os cinco
> providers a cada PR, e o tempo dela é caminho crítico do CI. Registre isso com
> essa palavra, "performance", explicitamente.
>
> **Granularidade.** Quando isto virar backlog, o trabalho vai ser fatiado em
> **muitos módulos com poucas tarefas cada**, não em poucos módulos com fila
> longa. Tenha isso em mente ao separar os assuntos.
>
> **O que NÃO decidir agora.** Não escolha endpoint, formato de payload nem
> estratégia de autenticação do Bitbucket. Isso é decisão de arquitetura, tomada
> depois, contra a documentação oficial. Aqui definimos **o quê** e **por quê**,
> não **como**.

---

## Antes de clicar em "Estou pronto para produzir"

Confira, no fio da sessão, que as regras de negócio foram **emitidas** — não só
mencionadas na conversa. Elas aparecem como artefatos.

Se você avançar sem elas, o PO gera o backlog inteiro e todas as stories ficam em
`draft`. Você só descobre nas sessões de execução, quando nenhum dev conseguir
pegar task, e aí terá gastado duas sessões para voltar ao começo.

Contagem esperada: **uma regra por afirmação da lista**, mais as que o Criativo
acrescentar. Menos que isso, continue conversando.

---

## Prompts de refino para a sessão 1 (PO)

O PO gera o backlog inteiro sozinho assim que você aceita o handoff — não espera
instrução. Estes prompts são para **depois**, olhando o que ele produziu na aba
Backlog.

**Se o backlog vier com poucos módulos e muitas tarefas:**

> Refatore o backlog para ter mais módulos com menos tarefas cada. A execução
> processa uma tarefa por módulo de cada vez, então fila longa dentro de um
> módulo não acelera nada — separar assuntos em módulos distintos, sim.

**Se nenhuma story tiver RNF de performance:**

> Nenhuma história tem requisito não-funcional de performance. Acrescente um
> explicitamente, usando a palavra "performance", na história que trata da suite
> de contrato — o tempo dela é caminho crítico do CI.

**Se alguma story ficou sem regra vinculada:**

> A história "X" não referencia nenhuma regra de negócio. Vincule as regras que a
> originaram — sem isso ela não fica pronta para execução.

**Para revisar cobertura:**

> Liste quais regras de negócio ainda não estão cobertas por nenhuma história.

---

## O que anotar na tabela desta sessão

- Quantas mensagens você precisou trocar com o Criativo até as regras saírem.
- Se ele emitiu regra demais, de menos, ou fora de escopo.
- Se o PO precisou de refino, quantas rodadas — e o que ele errou. **Devolução ao
  PO não tem registro no domínio**: se você não anotar, some.
