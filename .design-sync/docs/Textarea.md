---
category: Primitivas
keywords: [textarea, campo, texto, multilinha, formulário]
---

# Textarea

Campo de texto multilinha com rótulo, apoio e erro — o irmão do `Input` para
quando a resposta é um parágrafo.

## Como usar

```tsx
<Textarea
  label="Motivo"
  value={motivo}
  onChange={(e) => setMotivo(e.target.value)}
  hint="Vai como mensagem fixada na sessão do PO."
  placeholder="Ex.: os critérios de aceite não cobrem a recusa do pagamento."
/>

// Inválido: `error` substitui o `hint` e marca o campo.
<Textarea label="Motivo" error="Diga o que falta." />
```

## O que respeitar

- **Use `label`, não um `<label>` seu.** O componente gera o id e faz a
  associação — é isso que faz o clique no rótulo focar o campo.
- **`error` e `hint` não convivem.** Havendo erro, ele substitui o apoio: duas
  linhas de texto sob o campo competem, e a que importa perde.
- Aceita as props nativas de `<textarea>` (`rows`, `placeholder`, `maxLength`).
