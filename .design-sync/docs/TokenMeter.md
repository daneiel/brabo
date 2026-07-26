---
category: Primitivas
keywords: [tokens, custo, orçamento, medidor, consumo]
---

# TokenMeter

Medidor de consumo com custo. Barra com marcas em 70/90/100% e o valor nas duas
moedas — o controle de custo é assunto de primeira classe no produto.

## Como usar

```tsx
<TokenMeter used={184_320} limit={500_000} costBRL={12.47} costUSD={2.29} />

// Com o que o roteador poupou escolhendo modelo local.
<TokenMeter used={184_320} limit={500_000} costBRL={12.47} costUSD={2.29}
  savingsBRL={38.90} savingsPct={76} />
```

## O que respeitar

- **`used` e `limit` têm que estar na mesma unidade que `unitLabel` diz.** O
  default é "tokens". Passar contagem de token com `unitLabel="USD"` rotula o
  número errado — é o que o `ProjectCard` faz hoje, e é incoerência conhecida,
  não exemplo a copiar.
- `savings*` só quando houve economia real medida. Zerado, omita as duas.
- `variant`: `default` na tela de custo, `compact` em card ou sidebar, `live`
  durante uma sessão em andamento.
