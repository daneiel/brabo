/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    /*
     * `strictPort` porque a porta faz parte do CONTRATO de CORS (ADR 0037).
     *
     * Sem ele o Vite, ao encontrar 5173 ocupada, sobe em 5174 e só avisa numa
     * linha do log de boot. A api aceita exatamente `http://localhost:5173`
     * (`WEB_ORIGIN`), então a app abre normalmente e **toda** chamada é barrada
     * pelo navegador — inclusive o `/auth/refresh`, o que faz a tela parecer
     * deslogada. O erro no console fala de CORS e não de porta, então o tempo vai
     * todo para o lugar errado: mexer no CORS da api conserta o sintoma para 5174
     * e quebra 5173.
     *
     * Com `strictPort`, o Vite recusa subir e diz que a porta está em uso — o que
     * é a informação verdadeira. Reproduzido: 5173 ocupada, app em 5174, três
     * chamadas bloqueadas (`/health` da api, `/health` do engine, `/auth/refresh`).
     */
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
