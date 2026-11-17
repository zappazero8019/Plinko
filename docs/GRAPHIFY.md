# Graphify — Ferramenta de Análise Arquitetural

## Status no ambiente

O Graphify **está instalado** e foi executado novamente após a remoção final, quando
o mecanismo temporário foi eliminado, o precache foi reduzido e o projeto foi
preparado para publicação. Antes disso, foi executado nos ajustes finais e na Etapa G.

- **Versão instalada:** graphifyy 0.9.111
- **Python:** 3.14.6 (Python Launcher `py`)
- **Ambiente isolado:** `.venv-graphify/` dentro do projeto
- **Saída:** `graphify-out/` (ignorada pelo Git, regenerável)
- **Modo:** `--code-only` (sem chave de API LLM; 5 arquivos de docs não passaram por
  extração semântica, mas o código foi mapeado por AST local)

## Artefatos gerados (`graphify-out/`)

| Arquivo | Descrição |
|---------|-----------|
| `graph.html` | Grafo interativo (abrir no navegador, sem servidor) |
| `graph.json` | Dados brutos do grafo (**512 nós, 1503 arestas, 17 comunidades**) |
| `GRAPH_REPORT.md` | Relatório de auditoria arquitetural |
| `.graphify_analysis.json` | Comunidades, coesão e nós hub |
| `.graphify_build.json` | Metadados da build |
| `.graphify_root` | Raiz do escaneamento |
| `cache/` | Cache de extração incremental |
| `manifest.json` | Manifesto de arquivos escaneados |

## Como executar

```powershell
# Rebuild completo (usado nos ajustes finais, após mudanças estruturais)
.\.venv-graphify\Scripts\graphify.exe . --code-only --force
.\.venv-graphify\Scripts\graphify.exe cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz
.\.venv-graphify\Scripts\graphify.exe export html --graph graphify-out/graph.json --output graphify-out/graph.html

# Atualização incremental
.\.venv-graphify\Scripts\graphify.exe . --update --code-only
.\.venv-graphify\Scripts\graphify.exe cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz
.\.venv-graphify\Scripts\graphify.exe export html --graph graphify-out/graph.json --output graphify-out/graph.html
```

## Como interpretar

- **God Nodes:** `criarRenderer()` (47 arestas), `grupoCardMatch()` (32),
  `getAll()` (28), `grupoBanco()` (23), `grupoVisualizacaoCartas()` (23),
  `grupoPreferenciasEStats()` (23), `init()` (23), `grupoVolumes()` (22),
  `put()` (22) e `grupoSelfies()` (22).
- **Comunidades:** 17 no total; 13 exibidas no relatório e 4 finas (<3 nós) omitidas.
- **Extração:** 97% extraída, 3% inferida (47 arestas, confiança média 0,85).
- **Import Cycles:** **nenhum detectado** ✅.
- **Órfãos:** o único arquivo sem símbolos extraídos é `vendor/matter.min.js`,
  placeholder preexistente e não usado. Nenhum módulo do fluxo ativo ficou desconectado.
- **Surprising Connections:** ligações de teste, por exemplo `grupoPlinko()` →
  `World` e `grupoBanco()` → `closeDatabase()`.

## Relações esperadas no grafo (fluxo atual)

- `src/app/main.js` → `cardsInit()` / `cardsDestroy()`
- `src/games/cards/index.js` → `criarConfigExpandida()`, `criarSessao()`,
  `criarRenderer()`, `registrarPartida()`, `obterVisualizacaoCartas()`,
  `salvarVisualizacaoCartas()`
- `src/games/cards/index.js` → `game-stats.js` → `database.js`
- `src/games/cards/index.js` → `settings.js` → `database.js` (store `settings`, sem
  store paralela; `DB_VERSION = 2` apenas por causa da store `selfies`)
- `src/core/database.js` → `migrations.js` (`DB_VERSION_ATUAL` e `aplicarMigracoes`,
  versão única do esquema)
- `src/core/selfies.js` → `database.js`; `cards/index.js` → `selfies.js` (CRUD local,
  sem acesso direto ao banco pelo jogo)
- `src/games/cards/index.js` → `tentativas.js` → `expanded.js`/`board.js` (regras de
  tentativas, bônus e CHEAT)
- `src/games/cards/index.js` → `game-stats.js` → `database.js`, com `modalidade`,
  `cheat`, `derrota`, `bonusSelfies` e `selfiesPares`
- `src/app/main.js` → `renderizarPerfil()` em `src/ui/profile.js`, inclusive após
  restaurar backup; `renderizarConfiguracoes()` / `renderizarEstatisticas()` em
  `src/ui/panels.js`
- `src/core/profile.js` → `getAll()` / `put()` em `database.js` e
  `lerArquivoComoDataUrl()` em `selfies.js`; `salvarPerfil()` usa fila própria, sem
  store nova
- `src/core/settings.js` → `normalizarVolumeCartas()` e `getAll()` / `put()` em
  `database.js`; volumes não criam aresta para `wallet.js`
- Nenhuma aresta de `src/core/settings.js`, `selfies.js`, `profile.js` ou do renderer
  para `wallet.js`: nenhuma operação financeira; a ampliação é somente leitura do snapshot
- Os dois módulos legados preservados no disco aparecem como símbolos de
  compatibilidade, mas não são importados pelo fluxo ativo nem entram no precache
- Nenhuma aresta de `src/games/cards/` para `src/core/wallet.js`

## Regra de integridade

Nem Plinko nem o Jogo da Memória manipulam IndexedDB diretamente. O grafo confirma que
todo acesso passa por `src/core/database.js` pelos serviços centrais. Nenhum ciclo de
importação foi introduzido pelos ajustes finais.

## Última execução (remoção final — Memory Quest)

- Extração completa: **32 arquivos de código reprocessados com `--force`**, 5 docs
  ignorados pelo `--code-only`, 0 exclusões. `main.css` e `styles.css` não são
  classificados como código.
- Resultado: **512 nós, 1503 arestas, 17 comunidades**; 97% extraído, 3% inferido
  (47 arestas, confiança média 0,85).
- `Import Cycles`: **nenhuma** ✅.
- God nodes: `criarRenderer()` mantém **47 arestas**; `grupoCardMatch()` segue com
  **32**, `getAll()` com **28**, `grupoBanco()` com **23**,
  `grupoVisualizacaoCartas()` com **23**, `grupoPreferenciasEStats()` com **23** e
  `init()` com **23**. `grupoVolumes()`, `put()` e `grupoSelfies()` aparecem com 22.
- Módulos conectados: `core/profile.js`, `ui/profile.js`, `ui/panels.js` e
  `core/settings.js` seguem sem aresta para `wallet.js`.
- Órfãos: apenas `vendor/matter.min.js` (preexistente, placeholder não usado).
- Comandos executados:
  `.venv-graphify\Scripts\graphify.exe . --code-only --force`,
  `.venv-graphify\Scripts\graphify.exe cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz` e
  `.venv-graphify\Scripts\graphify.exe export html --graph graphify-out/graph.json --output graphify-out/graph.html`.
