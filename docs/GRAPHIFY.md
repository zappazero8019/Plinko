# Graphify — Ferramenta de Análise Arquitetural

## Status no ambiente

O Graphify **está instalado** e executado com sucesso nesta sessão.

- **Versão instalada:** graphifyy 0.9.111
- **Versão do Python:** 3.14.6 (via Python Launcher `py`)
- **Método de instalação:** ambiente virtual isolado em `.venv-graphify/` (dentro do projeto), sem alterar o Python global
- **Comando de instalação:** `.venv-graphify\Scripts\activate && python -m pip install graphifyy`
- **Diretório de saída:** `graphify-out/`
- **Comando efetivamente utilizado:** `graphify . --code-only` e `graphify cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz` + `graphify export html`

## Por que `--code-only`

O Graphify requer uma chave de API LLM (GEMINI_API_KEY, GOOGLE_API_KEY, etc.) para extração semântica de arquivos não-código (docs, papers, imagens). Como nenhuma chave foi configurada e não se deve solicitar/instalar sem autorização, foi usada a opção `--code-only`, que indexa apenas o código via AST local (sem necessidade de chave API). Os 5 arquivos em `docs/` foram pulados na extração semântica, mas a estrutura de dependências de código foi mapeada integralmente.

## Artefatos gerados (`graphify-out/`)

| Arquivo | Descrição |
|---------|-----------|
| `graph.html` | Grafo interativo (abrir no navegador, sem servidor) |
| `graph.json` | Dados brutos do grafo (226 nós, 551 arestas) |
| `GRAPH_REPORT.md` | Relatório de auditoria arquitetural |
| `.graphify_analysis.json` | Análise de comunidades, coesão, nós hub |
| `.graphify_build.json` | Metadados da build |
| `.graphify_root` | Diretório raiz do escaneamento |
| `cache/` | Cache de extração (incremental) |
| `manifest.json` | Manifesto de arquivos escaneados |

> O diretório `graphify-out/` está listado em `.gitignore` e **não deve ser versionado** (é regenerável a qualquer momento com `graphify . --code-only`).

## Como executar o Graphify neste projeto

A partir da raiz do projeto (`C:\Users\Samuel\Documents\Plinko`):

```powershell
# Ativar o ambiente virtual
.venv-graphify\Scripts\activate

# Gerar/atualizar o grafo completo (código apenas, sem chave API)
graphify . --code-only

# Gerar relatório e nomear comunidades (sem LLM labeling, sem viz)
graphify cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz

# Gerar HTML interativo
graphify export html --graph graphify-out/graph.json --output graphify-out/graph.html

# Atualização incremental (apenas arquivos novos/alterados)
graphify . --update --code-only
```

## Como interpretar os resultados

- **God Nodes:** nós mais conectados (abstrações centrais). No grafo atual: `grupoBanco()`, `PlinkoRenderer`, `World`, `transaction()`, `IDBObjectStore`, `init()`.
- **Comunidades:** agrupamentos de nós relacionados por dependência. Ex.: Community 3 = API do banco de dados (count, del, get, getAll, getByIndex, transaction); Community 1 = jogo Plinko; Community 2 = mock do IndexedDB (testes).
- **Surprising Connections:** ligações inesperadas entre módulos (ex.: testes chamando `World`, `clear()`, `openDatabase()`).
- **Import Cycles:** ciclos de importação. No grafo atual: **nenhum detectado** ✅.
- **Suggested Questions:** perguntas que o grafo está posicionado para responder (pontes entre comunidades, coesão de módulos).

## Relações esperadas no grafo

O grafo deve contemplar:

**Aplicação central:**
- Inicialização (`src/app/main.js` → `init()`)
- Roteamento (`src/app/router.js`)
- Navegação entre áreas
- Ciclo de vida dos jogos (init/destroy)

**Núcleo compartilhado:**
- Banco de dados (`src/core/database.js`)
- Carteira (`src/core/wallet.js`)
- Transações (`src/core/transactions.js`)
- Backup (`src/core/backup.js`)
- Migrações (`src/core/migrations.js`)

**Jogos independentes:**
- Plinko (`src/games/plinko/`)
- Card Match (`src/games/cards/`) — a ser implementado

**Interface:**
- Página inicial, carteira, loja, inventário, perfil

## Regra de integridade

O Plinko **não** deve manipular diretamente o IndexedDB. O Graphify deve ser usado para verificar essa conformidade a cada nova etapa. O grafo confirma que não há jogos acessando `indexedDB` diretamente — todo acesso vai por `src/core/database.js` via serviços de carteira.

## Como atualizar o grafo

Após cada etapa de implementação, executar:

```powershell
.venv-graphify\Scripts\activate
graphify . --update --code-only
graphify cluster-only C:\Users\Samuel\Documents\Plinko --no-label --no-viz
graphify export html --graph graphify-out/graph.json --output graphify-out/graph.html
```
