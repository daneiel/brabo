---
category: Primitivas
keywords: [alerta, aviso, erro, sucesso, mensagem, banner]
---

# Alert

Bloco de mensagem com ícone e tom. É para o que o usuário precisa ler antes de
seguir — não para status passageiro, que é `Badge`, nem para confirmação de
ação, que é toast.

## Como usar

```tsx
// O tom escolhe o ícone sozinho.
<Alert tone="accent">
  Nada foi alterado no repositório. Isto é o que o bootstrap <strong>faria</strong>.
</Alert>

// Erro que interrompe: `role="alert"` avisa o leitor de tela na hora.
<Alert tone="danger" role="alert">{erro}</Alert>

// Confirmação que pode esperar a pausa da leitura.
<Alert tone="success" role="status">Link enviado.</Alert>
```

## `role` é escolha, não consequência do tom

Esta é a regra que o [ADR 0036] fixou e a que mais se erra: `role="alert"` é
live region **assertiva** — interrompe o leitor de tela no meio da frase.
`role="status"` espera a pausa. Um `tone="danger"` que só descreve um estado da
tela não merece interromper ninguém, e um `tone="success"` que confirma o fim
de uma ação longa às vezes merece. Escolha pelo que a mensagem FAZ, não pela
cor dela.

Sem `role`, o bloco é decorativo para quem navega por leitor — o que é correto
quando o texto também está visível no fluxo.

## O que respeitar

- **Um Alert por assunto.** Três empilhados viram ruído e o usuário para de ler.
- O `children` aceita markup: `<strong>` no termo que importa ajuda a varredura.
- `icon` só quando o default do tom mente sobre a mensagem.
