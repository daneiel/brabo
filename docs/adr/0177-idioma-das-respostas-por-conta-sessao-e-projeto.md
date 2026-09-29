# 0177 — O idioma das respostas mora em três lugares — conta, sessão e projeto —, em lista aberta de BCP-47 e nunca no `users.locale`

## Status

**Accepted.** 2026-09-28 (AT-162, épico EP-028). Decisões do mantenedor de
2026-09-28, escritas nas notas da AT-168 e da AT-169: preferência por CONTA com
override por SESSÃO; lista ABERTA de idiomas (qualquer BCP-47); conta nova em
`automatico`; o detectado só vale CONFIRMADO; artefatos compartilhados e turnos
sem autor no idioma do PROJETO.

Referencia, sem editar, o [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) (tabela nova
entra no arquivo do agregado dela) e o [ADR 0006](0006-prompt-assembler-context-harness.md)
(o prompt de sistema é do AGENTE, não do autor do turno — é por isso que o
idioma não entra nele, e sim numa orientação por turno, que é da AT-164).

## Context

O idioma da resposta de um agente, até aqui, era decidido só pelo modelo, a
partir de um prompt de sistema escrito em pt-BR e das mensagens. O relato que
abriu o épico foi uma conversa em português respondida em espanhol, com
DeepSeek via OpenRouter. `users.locale` (RN-432) existe, mas é o idioma da
INTERFACE: fechado a `pt-BR`/`en` porque cada valor precisa de arquivo de
tradução, e o engine não o lê em ponto nenhum.

As decisões do mantenedor pedem quatro fontes que não existiam e uma que
existia, com uma precedência entre elas, e três escopos diferentes:

- a escolha explícita é da PESSOA e vale em todo projeto e sessão;
- a pessoa pode fixar OUTRO idioma numa sessão, só para ela — dois usuários
  na mesma sessão não se tocam;
- o detectado pelas mensagens é da PESSOA, global, e só conta depois de ela
  confirmar;
- o que é de todos (artefato compartilhado, turno sem autor) segue o PROJETO.

## Decision

1. **Nenhum enum.** Os três lugares guardam `text` com um código BCP-47
   CANÔNICO, validado na api por `normalizarIdiomaBcp47`
   (`apps/api/src/domain/iam/idioma-de-resposta.ts`): forma pela
   `Intl.getCanonicalLocales`, subtag de idioma conhecida pelo ICU do processo
   (`Intl.DisplayNames` com `fallback: 'none'`), nunca `und` nem uso privado,
   no máximo 35 caracteres. Abrir o idioma da RESPOSTA não depende de arquivo
   de recurso nenhum; um enum obrigaria migration a cada idioma, que é o custo
   que a decisão "lista aberta" recusou.
2. **Conta: duas colunas em `users`, e `locale` intocado.**
   `users.response_language` — `NULL` é o AUTOMÁTICO, e é assim que toda conta
   nasce (sem valor-sentinela dentro de uma coluna de idiomas). E o par
   `users.detected_language` + `users.detected_language_confirmed_at`, com um
   CHECK que exige os dois juntos: o detectado só existe CONFIRMADO. Quem grava
   o par é a AT-163 (a detecção e a pergunta de confirmação); a coluna nasce
   aqui porque é um degrau da precedência.
3. **Sessão: tabela `session_language_overrides`**, no agregado de sessões,
   com chave `{session_id, user_id}`. Configuração e não evento: fixar de novo
   é upsert, soltar é `DELETE`, e a sessão apagada leva as linhas. A chave é o
   PAR porque o override é da pessoa; não há leitura "da sessão inteira".
4. **Projeto: coluna `projects.language`** (implementada na AT-243, com o
   default e o papel mínimo decididos lá, na RN-619). É o idioma do que não tem
   um autor humano.
5. **A precedência de quem tem autor** (RN-618), resolvida por PESSOA e nunca
   por sessão: override da sessão > escolha da conta > detectado confirmado >
   `users.locale`. Como `users.locale` é `NOT NULL`, a cadeia sempre termina num
   idioma. O "pedido pontual" dentro de uma mensagem não é degrau: quem o atende
   é o modelo, pela redação da orientação.
6. **Um ponto de resolução.** `ResolverIdiomaDaRespostaUseCase` devolve o
   vencedor, a ORIGEM e a cadeia inteira; é o que a tela mostra (a Conta, a
   barra da sessão) e o que a AT-164 chama para mandar o idioma ao engine.

## Consequences

- `users.locale` continua fechado e continua sendo só da interface: nem a
  escolha das respostas nem a detecção escrevem nele. A página de Conta mostra
  os dois lado a lado, e a rota `PATCH /users/me/preferences` aceita os dois
  campos como OPCIONAIS e independentes.
- A lista de idiomas aceitos é a do ICU do Node que roda a api. Um código ISO
  639-3 raro que o ICU não nomeia é recusado, declarado — nenhum idioma de
  resposta plausível está nesse caso.
- Ainda não há consumidor no engine: nenhum turno muda de comportamento com
  este ADR. O transporte (a orientação efêmera por turno) é a AT-164; a
  detecção e a confirmação, a AT-163. Até lá, escolher um idioma na Conta é
  gravado e mostrado, e ainda não chega ao modelo — a tela não afirma o
  contrário.
- O override por sessão é permitido em sessão encerrada: ele não dispara turno
  nem escreve no event log.
