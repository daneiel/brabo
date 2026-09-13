# 0158 — O id da chave mestra gravado no envelope, como observabilidade e nunca como autoridade

## Status

**Accepted.** Corresponde ao `BRB-016` do registro do mantenedor, que declara
depender do `BRB-010` — e a dependência é literal: esta decisão muda o formato
do envelope, e a prova de que o formato atual sobrevive a uma rotação inteira
nasceu na mesma entrega, na [RN-562](../business-rules.md#rn-562), **antes**
desta linha de código. Não revoga o
[ADR 0027](0027-fase5-backup-hardening-release.md): o esquema de envelope, o
`CREDENTIALS_MASTER_KEY_PREVIOUS` e o `rewrap-deks.ts` seguem como estão.

## Context

`CREDENTIALS_MASTER_KEY` embrulha os DEKs que cifram os segredos do usuário —
chaves de LLM em `user_credentials` e tokens de git em
`project_git_connections`. A rotação dela é o procedimento com o pior desfecho
do runbook, e ele mesmo escreve por quê (`docs/runbook.md`, seção "What's at
stake"):

> *"The `wrapped_dek` stored in the database **doesn't identify which key
> wrapped it**."*

Medido em 2026-09-12, no checkout:

| arquivo:linha | o que está lá |
|---|---|
| `apps/api/src/db/schema/llm.ts:255` | `wrappedDek: text('wrapped_dek').notNull()` — seis colunas de envelope, nenhuma dizendo qual chave |
| `apps/api/src/db/schema/git.ts:72` | idem, as MESMAS seis colunas |
| `envelope-encryption.service.ts:128-138` | `decrypt` tenta a atual e cai para a anterior, dentro de um `catch` que não distingue motivo |
| `envelope-encryption.service.ts:148-160` | `rewrap` faz o mesmo, e o `catch` **sem motivo** é o que decide se o registro já está na chave atual |
| `docs/runbook.md`, "Before: size it up" | a única consulta possível conta **linhas totais** por tabela — nunca quantas faltam |

Disso saem dois defeitos concretos:

1. **O passo 2 da rotação não tem progresso.** Quem interrompe o script no meio
   não sabe onde parou; a única forma de descobrir é rodá-lo de novo e ler a
   contagem que ele imprime. E a pergunta que decide o passo 3 — *"ainda há
   credencial na chave velha?"* — não tem resposta em SQL.
2. **Chave errada e blob corrompido são o mesmo `catch`.** Os dois produzem a
   mesma falha genérica, e são diagnósticos com ações opostas: um pede
   republicar a chave anterior, o outro pede investigar o registro.

A lição que governa esta área é a
[RN-475](../business-rules.md#rn-475): um id que devia estar gravado dentro do
material e não estava fez o modo automático nunca autenticar, e custou uma
caçada por um defeito de uma linha.

## Decision

### 1. O envelope passa a carregar `key_id`, em COLUNA

`user_credentials` e `project_git_connections` ganham `key_id text` **anulável**,
e `EncryptedSecret` ganha `keyId?: string | null`. As duas tabelas mudam
JUNTAS: elas compartilham o mesmo envelope e o mesmo script, e mexer numa só
produziria um acervo em que a consulta responde metade.

Coluna, e não prefixo dentro do blob, porque o consumidor principal **é uma
consulta SQL** — o passo 2 do runbook. Um prefixo obrigaria a ler e decodificar
cada linha para responder "quantas faltam", que é a pergunta que motivou tudo.

### 2. O valor é a IMPRESSÃO DIGITAL da chave derivada, e nada mais

```
key_id = HMAC-SHA256(chave_derivada, 'brabo-master-key-id')  → 16 primeiros hex
```

Isso responde o `TODO(humano)` que a atividade deixou aberto — *"de onde sai o
valor do `key_id`? Não pode ser hash da chave (dá oráculo de verificação
offline a quem lê o banco), e um contador manual no `.env` é mais uma variável
que o operador pode errar."* As duas metades da objeção foram tratadas, e a
primeira foi **medida, não suposta**:

**Não há oráculo novo.** Quem lê o banco já tem um oráculo de verificação
offline PERFEITO, e ele é o próprio envelope: `wrapped_dek` + `dek_iv` +
`dek_auth_tag` são AES-256-GCM, que AUTENTICA. Testar uma passphrase candidata
já hoje é `scryptSync(candidata, SALT, 32)` seguido de um decipher cuja tag
verifica ou não — resposta certa, por candidata. Com o `key_id`, testar a mesma
candidata é `scryptSync(candidata, SALT, 32)` seguido de um HMAC. **O custo por
tentativa é o mesmo nos dois casos, e ele é dominado pelo `scrypt`, que ambos
precisam pagar.** Um atacante com leitura do banco não ganha nada; o que ele
ganharia era coisa que já tinha.

**E não há variável nova.** O operador não digita o `key_id` em lugar nenhum:
ele é função pura da chave que o operador já publicou. Não há segundo valor
para manter em sincronia, que era o argumento que o docblock do serviço usava
para não gravar id nenhum (`envelope-encryption.service.ts:36-38`, *"um
identificador de chave no registro é mais um metadado a manter em
sincronia"*) — verdade para um id ARBITRÁRIO, falsa para uma impressão digital.

O que se grava é HMAC, não a chave nem material dela, e são 8 bytes.

### 3. O `key_id` é OBSERVABILIDADE, nunca AUTORIDADE — e é aqui que esta decisão se afasta do óbvio

A leitura NÃO passa a escolher a chave pelo rótulo. `decrypt` fica **byte a
byte** como está: tenta a atual, cai para a anterior, GCM decide. `rewrap`
também mantém a tentativa como o critério de "já está na chave atual".

O caminho óbvio — usar `key_id` para pular a tentativa — foi considerado e
**recusado por um modo de falha próprio**: uma linha cujo rótulo diz "atual"
mas cujo envelope está na chave velha seria pulada pelo `rewrap` em silêncio,
ficaria fora da conta de re-embrulhados, e o passo 3 do runbook a tornaria
ilegível para sempre. O rótulo é um dado a mais numa coluna; o envelope é a
verdade. **Trocar a autoridade da criptografia por um rótulo transforma uma
incoerência de metadado em perda de segredo.**

Então o rótulo serve a três coisas, todas fora do caminho de decisão
criptográfica:

- **a consulta** do passo 2 (`WHERE key_id IS DISTINCT FROM '<atual>'`);
- **o diagnóstico** quando NENHUMA das duas chaves abre — a mensagem passa a
  nomear qual chave embrulhou aquele registro, distinguindo "veio de outro
  ambiente" de "registro sem `key_id`, gravado antes desta mudança" e de "o
  rótulo diz que está na atual e mesmo assim não abre", que é a incoerência
  acima e merece ser dita em voz alta;
- **a origem**, que o `rewrap` grava junto com o envelope novo.

### 4. Nada de migração do acervo

O `key_id` nasce **na próxima escrita**: `encrypt` o grava, `rewrap` o grava. As
linhas de hoje ficam com `NULL`, e `NULL` quer dizer exatamente *"gravada antes
desta mudança, chave desconhecida"* — nunca *"na chave atual"*. Forçar um
re-embrulho do acervo inteiro só para preencher a coluna transformaria uma
melhoria de observabilidade numa operação de risco sobre todas as credenciais.

Consequência aceita e declarada: **numa instalação existente, a consulta do
passo 2 só passa a valer depois da primeira rotação.** Antes dela, tudo é
`NULL`, e a resposta honesta da consulta é "não sei de nenhuma", que é diferente
de zero — por isso a consulta do runbook conta as três faixas separadas
(atual / anterior / sem rótulo) em vez de um número só.

### 5. O operador precisa saber a impressão digital ATUAL, então a api a diz

Uma coluna que ninguém consegue comparar contra nada é inútil. O serviço passa a
registrar no boot, em UMA linha, a impressão digital da chave corrente, e a
advertência de rotação que já existia (`:75-78`) passa a nomear as DUAS. É o
mesmo lugar onde o runbook já manda o operador olhar (*"Confirm the api is in
rotation mode — it warns in the log"*).

Sair em log é seguro pelo mesmo argumento do ponto 2: é HMAC de 8 bytes, e não
barateia nenhuma tentativa contra o banco.

## Consequences

**O que passa a ser possível**

- Responder *"quantas credenciais ainda estão na chave anterior?"* em SQL, e é
  isso que fecha o critério do `BRB-016`. O runbook usa a consulta nos passos 2
  e 3.
- Distinguir, na saída do `rewrap-deks.ts`, um registro de outro ambiente de um
  registro adulterado — antes eram a mesma linha de erro.
- Interromper o passo 2 e retomar sabendo o que falta, sem depender da contagem
  impressa por uma execução que já terminou.

**O preço, declarado**

- Uma migration em duas tabelas (`ALTER TABLE ... ADD COLUMN key_id text`).
  Anulável e sem default, então é metadado novo em coluna nova: não reescreve
  linha, não trava tabela grande.
- O acervo existente fica sem rótulo até a primeira rotação (ponto 4).
- Instalação que restaure um dump de OUTRO ambiente ganha um sintoma novo e
  melhor: o `key_id` das linhas não bate com o do log, e o
  [Restore](../runbook.md#restore) deixa de precisar do diagnóstico por
  eliminação que o runbook descreve hoje.

**O que NÃO muda, e é a metade que importa**

- O algoritmo, o tamanho do DEK, o `SALT` e o `scrypt`. Nenhum byte de
  `encryptedApiKey` é reescrito por nada disto.
- `decrypt`. O fallback de duas chaves continua sendo o mecanismo, e continua
  sendo a criptografia quem decide.
- O nome e a invocação do script (`node scripts/rewrap-deks.js`), que o runbook
  já aponta.
- O número de passos da rotação: continua **três**. Esta decisão a torna
  OBSERVÁVEL, nunca mais curta.

**O que fica de fora, nomeado**

- KMS, HSM e chave por tenant seguem sendo outro desenho, e o ADR 0027 fica como
  está.
- Um índice sobre `key_id`. As duas tabelas são pequenas por natureza (uma linha
  por usuário/provider, uma por projeto), e a consulta roda a cada muitos meses,
  numa rotação: um índice custaria escrita todo dia para poupar um seq scan
  duas vezes por ano.
- A metade de decrypt do diagnóstico. Quem lê o diagnóstico é o operador rodando
  o script, e é lá que ele está; pôr a mesma mensagem no caminho quente de
  leitura mudaria `decrypt`, que este ADR decidiu não tocar.
