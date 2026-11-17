# Status do Projeto — Arcade Collection

## Repositório

- **Nome:** Plinko (representa toda a Arcade Collection)
- **URL oficial:** https://github.com/zappazero8019/Plinko
- **Estado local:** Repositório Git inicializado (branch `main`, remoto `origin` configurado)
- **Conexão local × remoto:** Configurada (remoto `origin` aponta para `https://github.com/zappazero8019/Plinko.git`)
- **Backup pré-Git:** `C:\Users\Samuel\Documents\Backups\Plinko_pre_git` (26 arquivos)
- **Última validação:** 45 testes aprovados, 0 falhas

## Etapas

| Etapa | Status | Detalhes |
|-------|--------|----------|
| Alpha — Estrutura do projeto | ✅ Concluída | Estrutura, interface retrô, navegação 5 áreas, IndexedDB, perfil, carteira, histórico, backup/export/import, stubs Plinko/Cartas, loja/inventário, manifest, service worker, testes básicos (36 testes aprovados) |
| Fase 2A — Motor físico do Plinko | ✅ Concluída e auditada | Motor físico próprio (physics.js), renderer Canvas 2D, 4 dificuldades (8/12/14/16 fileiras), apostas virtuais, colisões reais, compartimentos de premiação, efeitos sonoros/visuais, integração exclusiva com carteira central, 9 testes de física/economia adicionados (total 45 aprovados) |
| Integração GitHub | ✅ Concluída | Git local inicializado, branch `main`, remoto `origin` configurado, backup pré-Git criado, sem commit/push (não autorizado) |
| Graphify | ✅ Instalado e executado | graphifyy 0.9.111 em venv `.venv-graphify`, grafo gerado (226 nós, 551 arestas, 12 comunidades), sem ciclos de importação, graph.html/GRAPH_REPORT.md/graph.json em graphify-out/ |
| Fase 2B — Card Match Clássico | ⏳ Aguardando autorização | Auditora repositório de referência (NavarroEmilioLuis/SMB3-Cards-Minigame), verifica licença, implementa independentemente, integra com carteira central |
| Fase 2C — Card Match Expandido | ⏳ Aguardando conclusão da 2B | Dificuldades 18/30/48/72/100 cartas, pontuação, tentativas, cronômetro, adaptação mobile |

## Módulos implementados

### Núcleo (core/)
- `database.js` — IndexedDB, 9 stores, transações, integridade ✅
- `wallet.js` — Carteira, saldo, addCoins, debitCoins, idempotência, atômico ✅
- `transactions.js` — Consultas agregadas, duplicatas, consistência ✅
- `achievements.js` — stub (Alpha) ⏳
- `collectibles.js` — stub (Alpha) ⏳
- `shop.js` — stub (Alpha) ⏳
- `backup.js` — Export/import JSON com validação ✅
- `migrations.js` — Controle de versão ✅

### Jogos (games/)
- `plinko/` — Física, renderer, jogo completo, dificuldades, recompensas ✅
- `cards/` — Stub (Alpha) ⏳

### Interface (app/)
- `main.js` — Ponto de entrada, ciclo de vida dos jogos ✅
- `router.js` — Navegação por hash, 5 áreas ✅
- `components.js` — Helpers de UI ✅

### Infraestrutura
- `index.html` — SPA leve ✅
- `manifest.json` — PWA ✅
- `service-worker.js` — Cache offline ✅
- `styles/main.css` — Estilo retrô + Plinko ✅
- `vendor/matter.min.js` — Placeholder (não utilizado) ✅
- `.gitignore` — Configurado ✅
- `graphify-out/` — Artefatos do Graphify (não versionado) ✅

## Testes

- Suíte: `tests/index.test.mjs`
- Total: **45 aprovados, 0 falhas**
- Cobertura: banco, carteira, transações, recompensas, dificuldades, física Plinko, economia Plinko, backup
- Execução: `node tests/index.test.mjs`
- Validação sintática: `node --check` em todos os 16 módulos JS — válido

## Pendências

1. Fazer commit e push para o repositório remoto `zappazero8019/Plinko` (requer autorização explícita — não autorizado nesta tarefa).
2. Implementar Fase 2B — Card Match Clássico (requer autorização).
3. Implementar Fase 2C — Card Match Expandido (requer conclusão da 2B).
4. Implementar loja, inventário, conquistas, estatísticas (stubs existentes).
5. Testes no navegador real e Android (não executados nesta sessão).

## Recomendação para próxima etapa

Aguardar autorização para: (a) fazer commit/push para o repositório remoto, ou (b) iniciar a Fase 2B — Card Match Clássico. Não iniciar 2B sem autorização explícita.
