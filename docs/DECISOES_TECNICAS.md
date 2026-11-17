# Decisões Técnicas — Arcade Collection

## 1. Motor físico próprio no Plinko (Fase 2A)

**Decisão:** Utilizar um motor físico próprio em JavaScript puro
(`src/games/plinko/physics.js`) em vez da biblioteca Matter.js.

**Motivo:**
- Duas tentativas de download do Matter.js (cdnjs e raw.githubusercontent)
  resultaram em arquivos truncados (~80 KB de ~400+ KB necessários),
  inutilizáveis como biblioteca funcional.
- O motor próprio atende plenamente ao requisito de "física real, não animação
  simulada": integração semi-implicit Euler com substepping, detecção de
  colisão círculo-círculo (bola-pino, bola-bolinha) e círculo-segmento
  (bola-parede), resolução por impulso com restituição e fricção, gravidade
  configurável, corpos estáticos e dinâmicos, dormência para otimização.
- Está alinhado com a regra de "evitar frameworks desnecessários" e "nenhuma
  dependência externa obrigatória".
- É armazenado localmente no repositório, sem dependência de CDN.

**Impacto:**
- O `vendor/matter.min.js` permanece como placeholder (não utilizado pelo jogo).
- O Service Worker ainda lista `./vendor/matter.min.js` como asset essencial
  (o arquivo existe e é válido, apenas não é a biblioteca real).
- O motor pode ser substituído por Matter.js no futuro sem afetar a camada de
  jogo (`index.js`) nem a carteira central, pois a dependência está restrita a
  `physics.js`.

## 2. Integração dos jogos por APIs centrais

**Decisão:** Nenhum jogo manipula diretamente o IndexedDB nem altera o saldo.
Todos solicitam operações ao serviço central (`src/core/wallet.js`).

**Motivo:**
- Garantir integridade financeira: saldo nunca negativo, transações atômicas,
  idempotência, histórico completo.
- Separar completamente jogos dos sistemas compartilhados (regra obrigatória
  do projeto).
- Permitir adicionar novos jogos sem modificar o núcleo.

**APIs expostas aos jogos:**
- `getSaldo()`, `getEstado()`
- `addCoins(quantidade, meta)` — crédito atômico
- `debitCoins(quantidade, meta)` — débito atômico (recusa saldo insuficiente)
- `registrarTransacao(transacao)`
- `validarRecompensa(quantidade, origem)`

## 3. Carteira virtual compartilhada

**Decisão:** Uma única carteira compartilhada por todos os jogos.

**Motivo:**
- Moedas conquistadas em um jogo podem ser usadas em outro.
- Saldo visível em todas as áreas principais (cabeçalho).
- Histórico unificado de movimentações.
- Sobrevive ao fechamento do navegador (IndexedDB).

**Regras obrigatórias:**
1. Nunca permitir saldo negativo.
2. Impedir transações duplicadas (idempotencyKey).
3. Impedir compras repetidas de itens únicos.
4. Registrar todas as movimentações.
5. Validar recompensas antes de creditá-las.
6. Não conceder moedas por simplesmente abrir ou trocar de jogo.
7. Utilizar identificadores únicos para operações.
8. Atualizações financeiras de forma atômica.

## 4. Persistência IndexedDB

**Decisão:** IndexedDB como banco principal, com 9 stores independentes.

**Motivo:**
- Armazenamento principal robusto, suporte a transações.
- Controle de versão do banco (`DB_VERSION = 1`).
- Migrações preparadas para evolução futura.
- Verificação de integridade e solicitação de persistência persistente
  (`navigator.storage.persist()`).
- LocalStorage somente para preferências simples (não utilizado atualmente).

## 5. Ausência de backend obrigatório

**Decisão:** Nenhum backend, banco de dados remoto ou autenticação obrigatória.

**Motivo:**
- Hospedagem gratuita no GitHub Pages (estático).
- Funcionamento offline via Service Worker.
- Dados permanecem localmente no dispositivo do usuário.
- Backup/restauração via exportação/importação JSON.

## 6. GitHub Pages como destino de hospedagem

**Decisão:** Publicar no GitHub Pages, repositório `zappazero8019/Plinko`.

**Motivo:**
- Hospedagem gratuita e confiável.
- Suporte a PWA e service worker.
- Compatível com subdiretórios (caminhos relativos `./`).
- `.nojekyll` para desativar processamento Jekyll.

## 7. Graphify como ferramenta permanente de análise arquitetural

**Decisão:** Utilizar Graphify permanentemente para mapear a arquitetura a cada etapa.

**Motivo:**
- Detecção de dependências circulares (resultado atual: nenhum detectado ✅).
- Verificação de separação núcleo × jogos (confirmada no grafo).
- Auditoria contínua da integridade arquitetural.
- Identificação de nós hub (God Nodes) e pontes entre comunidades.

**Status:** Instalado e executado (graphifyy 0.9.111, Python 3.14.6, venv `.venv-graphify`).
Grafo gerado: 226 nós, 551 arestas, 12 comunidades, sem ciclos de importação.
Artefatos em `graphify-out/` (não versionado, está em `.gitignore`).

**Comandos:**
- `graphify . --code-only` — gerar/atualizar grafo (código apenas, sem chave API)
- `graphify cluster-only <path> --no-label --no-viz` — gerar GRAPH_REPORT.md
- `graphify export html` — gerar grafo interativo

## 8. PWA e funcionamento offline

**Decisão:** Service Worker com Cache First para assets essenciais, manifest.json
com `display: standalone`, compatível com subdiretórios do GitHub Pages.

**Motivo:**
- Funcionamento após carregamento e instalação, sem serviços externos.
- Instalação como PWA no Android.
- Compatível com computadores e dispositivos móveis.

## 8. PWA e funcionamento offline

**Decisão:** Service Worker com Cache First para assets essenciais, manifest.json
com `display: standalone`, compatível com subdiretórios do GitHub Pages.

**Motivo:**
- Funcionamento após carregamento e instalação, sem serviços externos.
- Instalação como PWA no Android.
- Compatível com computadores e dispositivos móveis.
