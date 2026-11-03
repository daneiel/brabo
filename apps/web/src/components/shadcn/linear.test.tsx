import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CabecalhoDePagina } from "./cabecalho-de-pagina"
import { SectionCards } from "./section-cards"
import { GradeCelula } from "./table"

describe("fundação linear", () => {
  it("cabeçalho mostra título, descrição e ações", () => {
    render(
      <CabecalhoDePagina titulo="T" descricao="D" acoes={<button>Ir</button>} />
    )
    expect(screen.getByRole("heading", { name: "T" })).toBeTruthy()
    expect(screen.getByText("D")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ir" })).toBeTruthy()
  })
  it("cards de métrica desenham rótulo e valor", () => {
    render(<SectionCards metricas={[{ rotulo: "Custo", valor: "12" }]} />)
    expect(screen.getByText("Custo")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
  })
  it("sem métricas não desenha card", () => {
    const { container } = render(<SectionCards metricas={[]} />)
    expect(container.querySelectorAll("[data-slot=section-card]").length).toBe(0)
  })
  it("célula da grade não tem borda lateral", () => {
    const { container } = render(<GradeCelula>x</GradeCelula>)
    expect(container.firstElementChild?.className).not.toMatch(/border-l/)
  })
})
