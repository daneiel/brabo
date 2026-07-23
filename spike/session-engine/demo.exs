alias SessionEngine.{Agent, SessionServer, SessionSupervisor}

IO.puts("== Spike: Session Engine (OTP puro) ==")

# --- Sessão 1: dois agentes trocam mensagens, encerra normalmente ---
IO.puts("\n--- Sessão 1: troca de mensagens entre dois agentes, depois encerramento normal ---")
{:ok, session1} = SessionSupervisor.start_session("sessao-1-normal")
agente_a = Agent.start(:agente_a, session1)
agente_b = Agent.start(:agente_b, session1)
Agent.set_peer(agente_a, agente_b)
Agent.set_peer(agente_b, agente_a)

Agent.send_message(agente_a, "Oi, bora começar a análise do ticket #42?")
Process.sleep(50)
Agent.send_message(agente_b, "Show, vou levantar os requisitos agora.")
Process.sleep(50)
Agent.send_message(agente_a, "Beleza, me chama quando tiver o esboço.")
Process.sleep(50)

IO.puts("-> Encerrando sessão 1 normalmente (SessionServer.stop/1 => GenServer.stop(pid, :normal))")
SessionServer.stop(session1)
Process.sleep(100)

# --- Sessão 2: morta com Process.exit(pid, :kill) ---
IO.puts("\n--- Sessão 2: morte por Process.exit(pid, :kill) ---")
{:ok, session2} = SessionSupervisor.start_session("sessao-2-killed")
SessionServer.log(session2, :sistema, "sessão iniciada, aguardando processamento")
SessionServer.log(session2, :agente_a, "iniciando tarefa pesada...")
Process.sleep(50)

IO.puts("-> Matando sessão 2 com Process.exit(pid, :kill)")
Process.exit(session2, :kill)
Process.sleep(100)

# --- Sessão 3: crash com raise dentro do próprio GenServer ---
IO.puts("\n--- Sessão 3: crash real (raise) dentro do GenServer ---")
{:ok, session3} = SessionSupervisor.start_session("sessao-3-crash")
SessionServer.log(session3, :sistema, "sessão iniciada")
SessionServer.log(session3, :agente_b, "processando payload inválido...")
Process.sleep(50)

IO.puts("-> Provocando crash na sessão 3 (SessionServer.crash/1 -> raise)")
SessionServer.crash(session3)
Process.sleep(200)

IO.puts("\n== Fim do demo — os três términos acima foram capturados pelo PsychologistMonitor ==")
