---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
---

# 输入 0——会话 0（Criativo）的输入文本

Fase 10b 的操作材料。本文件包含要粘贴到第一次会话聊天中的**字面文本**，以及下一次会话的细化 prompt。

## 为什么是 Criativo，而不是 PO {#por-que-o-criativo-e-não-o-po}

原计划是直接把输入 handoff 给 PO。这是不可能的，而原因很重要，因为它也解释了下面文本的格式。

通往 PO 的唯一路径是“Estou pronto para produzir”按钮，它只在 Criativo 活动时出现——不存在给任选 agent 的手动 handoff。即使存在，单靠 PO 也解决不了：一个故事只有在**至少关联一条业务规则**时才能到达 `ready`，每个 `business_rule_id` 都会针对一个真实的 `artifact.business_rule` 事件进行验证，而 PO **没有发出该构件的工具**——只有 Criativo 有。

日志中没有业务规则，就没有任何故事会变成 `ready`；没有 `ready` 的故事，就没有任何 dev 会领取任务。所以下面的文本如此强调规则：**它们是解锁整个执行的东西**，而不是文档的装饰。

机制上的细节：产品中没有上传或附件。让输入的内容到达 agent 的唯一方式，是你在消息框中**粘贴文本**。

---

## 要粘贴的文本 {#o-texto-para-colar}

把这段粘贴到会话 0 的第一条消息中。它有意写得很长——Criativo 无法访问仓库，所以上下文必须一起提供。

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

（上面引用的文本是要原样粘贴到产品中的输入，因此保留葡萄牙语原文。）

---

## 在点击“Estou pronto para produzir”之前 {#antes-de-clicar-em-estou-pronto-para-produzir}

在会话的消息流中确认业务规则已经被**发出**——而不只是在对话中被提到。它们以构件的形式出现。

如果你在没有它们的情况下推进，PO 会生成整个 backlog，而所有故事都会停留在 `draft`。你只会在执行会话中发现，当没有任何 dev 能领取任务时，那时你已经花了两次会话才回到起点。

预期数量：**列表中每条断言一条规则**，再加上 Criativo 补充的。少于这个数，就继续对话。

---

## 会话 1（PO）的细化 prompt {#prompts-de-refino-para-a-sessão-1-po}

你一接受 handoff，PO 就会自己生成整个 backlog——它不等指令。这些 prompt 是给**之后**用的，在 Backlog 标签页中查看它产出的东西时。

**如果 backlog 模块很少、任务很多：**

> Refatore o backlog para ter mais módulos com menos tarefas cada. A execução
> processa uma tarefa por módulo de cada vez, então fila longa dentro de um
> módulo não acelera nada — separar assuntos em módulos distintos, sim.

**如果没有任何故事带有性能的非功能需求：**

> Nenhuma história tem requisito não-funcional de performance. Acrescente um
> explicitamente, usando a palavra "performance", na história que trata da suite
> de contrato — o tempo dela é caminho crítico do CI.

**如果某个故事没有关联规则：**

> A história "X" não referencia nenhuma regra de negócio. Vincule as regras que a
> originaram — sem isso ela não fica pronta para execução.

**用于检查覆盖率：**

> Liste quais regras de negócio ainda não estão cobertas por nenhuma história.

---

## 在本次会话的表格中记录什么 {#o-que-anotar-na-tabela-desta-sessão}

- 你需要和 Criativo 交换多少条消息，规则才产出。
- 它发出的规则是太多、太少，还是超出范围。
- PO 是否需要细化、几轮——以及它错在哪里。**退回给 PO 在领域中没有记录**：如果你不记下来，它就会消失。
