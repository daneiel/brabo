---
category: Wizard
keywords: [credencial, token, git, pat, provider, segredo]
---

# CredentialStep

O passo do wizard que escolhe uma credencial de git já cadastrada ou registra
uma nova.

## Como usar

```tsx
<CredentialStep
  provider="github"
  credentials={credenciais}
  selectedId={escolhida}
  onSelect={setEscolhida}
  onRegister={(token) => registrar(token)}
  registering={salvando}
  error={erro}
/>
```

## O que respeitar

- **`credentials` são só metadados** (id, provider, datas). O token nunca chega
  ao browser depois de salvo — é envelope encryption, e o componente foi feito
  assumindo isso. Não espere exibir o segredo.
- **`error` e `registering` só aparecem com o formulário de novo token aberto**,
  e ele começa aberto apenas quando não existe nenhuma credencial. Em preview ou
  teste, clique em "Adicionar novo token" para ver esses estados.
- `error` deve dizer o que fazer, não só que falhou: qual escopo falta, qual
  permissão o token não tem.
- `onRegister` recebe o token em texto e é chamado uma vez; `registering` é
  quem impede o duplo envio.
