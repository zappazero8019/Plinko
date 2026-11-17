# Arcade Collection — Documentação de Arquitetura

## Visão geral
Aplicativo web de minijogos retrô (Plinko, Card Match em breve) com carteira virtual
compartilhada, loja, inventário, conquistas, estatísticas, backup/restauração,
funcionamento offline e instalação PWA. Publicado no GitHub Pages (subdiretório).

O nome do repositório é **Plinko**, mas seu conteúdo representa toda a Arcade Collection.

## Pilha de tecnologia
- HTML5, CSS3, JavaScript moderno com ES Modules (sem build, sem frameworks).
- Canvas 2D (renderização do Plinko).
- Motor físico próprio em JavaScript puro (physics.js) — sem dependências externas.
- IndexedDB (banco principal) + LocalStorage (apenas preferências simples).
- Service Worker + Web App Manifest (PWA, offline).
- Web Audio API (efeitos sonoros procedurais, sem arquivos externos).

## Estrutura de pastas
```
arcade-collection/ (raiz do repositório)
├── index.html                # Página única (SPA leve)
├── manifest.json             # Web App Manifest
├── service-worker.js         # Cache offline + instalação PWA
├── .nojekyll                 # Desativa Jekyll no GitHub Pages
├── styles/main.css           # Estilo retrô (escuro, pixel, responsivo)
├── src/
│   ├── app/
│   │   ├── main.js           # Ponto de entrada (inicializa DB, wallet, router, PWA, jogos)
│   │   └── router.js         # Navegação por hash entre as 5 áreas (sem recarregar)
│   ├── core/                 # Sistemas compartilhados (nunca tocados diretamente pelos jogos)
│   │   ├── database.js       # IndexedDB: stores, transações, integridade, migrações
│   │   ├── wallet.js         # Carteira: saldo, addCoins, debitCoins, histórico (atômico)
│   │   ├── transactions.js   # Consultas agregadas do histórico financeiro
│   │   ├── achievements.js   # (stub Alpha) sistema de conquistas
│   │   ├── collectibles.js   # (stub Alpha) colecionáveis
│   │   ├── shop.js           # (stub Alpha) loja interna
│   │   ├── backup.js         # Exportação/importação JSON com validação
│   │   └── migrations.js     # Controle de versão do banco
│   ├── games/
│   │   ├── plinko/           # Plinko (Fase 2A completa)
│   │   │   ├── index.js      # Jogo: física, render, áudio, carteira, UI
│   │   │   ├── physics.js    # Motor físico próprio (círculo-círculo, círculo-segmento)
│   │   │   ├── renderer.js   # Renderer Canvas 2D responsivo
│   │   │   ├── difficulty.js # Configurações de dificuldade (8/12/14/16 fileiras)
│   │   │   └── rewards.js    # Cálculo de prêmio + validação
│   │   └── cards/            # Card Match (a ser implementado na Fase 2B/2C)
│   │       ├── index.js      # (stub Alpha)
│   │       └── difficulty.js # Configurações (18/30/48/72/100 cartas)
│   └── ui/
│       └── components.js     # Helpers de UI (toast, confirmação, card da loja)
├── vendor/
│   └── matter.min.js         # Placeholder (substituído por motor físico próprio)
├── tests/
│   └── index.test.mjs        # Suíte de testes automatizados (Node, sem dependências)
└── docs/
    ├── ARQUITETURA.md        # Este documento
    ├── GRAPHIFY.md           # Como executar o Graphify
    ├── DECISOES_TECNICAS.md  # Decisões arquiteturais registradas
    └── STATUS_PROJETO.md     # Status das etapas do projeto
```

## Separação núcleo × jogos

**Nunca** um jogo manipula diretamente o IndexedDB nem altera o saldo.
Todos acessam os serviços centrais por interfaces bem definidas (`src/core/wallet.js`):

- `getSaldo()` — leitura de saldo
- `addCoins(qtd, meta)` — crédito atômico (carteira + transação numa só transação IndexedDB)
- `debitCoins(qtd, meta)` — débito atômico (recusa saldo insuficiente)
- `registrarTransacao(tx)` — gravação de histórico
- `validarRecompensa(qtd, origem)` — validação prévia de recompensa
- `getHistorico(limite)` — histórico de movimentações

## Fluxo de dados (Plinko → Carteira)

1. Usuário define aposta e clica em LANÇAR.
2. `launchBall()` chama `debitCoins(aposta, {origem:'plinko', jogo:'plinko', idempotencyKey})`.
3. Se aprovado, a bolinha é criada no motor físico (`createBall`).
4. Loop de animação avança o mundo físico (`world.step(dt)`) e renderiza.
5. Quando a bolinha para num compartimento (dormência + posição inferior), `processResult()` calcula o prêmio.
6. `validarRecompensa(premio, 'plinko')` valida antes de creditar.
7. `addCoins(premio, {origem:'plinko', jogo:'plinko', idempotencyKey})` credita atômico.
8. Saldo é lido apenas via `getSaldo()` para exibição na UI.

## Regras obrigatórias implementadas

1. **Nenhum jogo manipula o banco ou saldo diretamente.**
2. **Transações financeiras atômicas** (carteira + histórico numa só transação IndexedDB).
3. **Nunca saldo negativo.** `debitCoins` recusa quando `saldo < quantidade`.
4. **Idempotência.** Chave `idempotencyKey` impede transações duplicadas.
5. **Todas as movimentações registradas** na store `transactions`.
6. **Nenhuma moeda concedida por abrir/trocar de jogo.** Somente via ações com recompensa validada.
7. **Identificadores únicos** para operações (`idempotencyKey`).
8. **Backup valida estrutura, versão e dados inválidos**; exige confirmação explícita na UI antes de restaurar.
9. **Persistência solicitada** via `navigator.storage.persist()` quando disponível.

## Persistência local

- IndexedDB: stores `profile`, `wallet`, `transactions`, `games`, `matches`,
  `inventory`, `achievements`, `settings`, `metadata`.
- Controle de versão do banco (`DB_VERSION = 1`).
- Migrações preparadas em `migrations.js`.
- Verificação de integridade em `verifyIntegrity()`.
- `navigator.storage.persist()` solicitado na inicialização.

## Navegação

- Router por hash (`#home`, `#plinko`, `#cards`, `#shop`, `#profile`).
- `history.pushState`/`replaceState` — sem recarregar a página.
- Saldo e progresso sobrevivem à troca de área.
- Navegação inferior fixa (touch-friendly, áreas confortáveis de toque).
- Carteira visível no cabeçalho em todas as áreas principais.

## PWA e offline

- `manifest.json` com ícones, `display: standalone`, `scope: './'`, `start_url: './index.html'`.
- `service-worker.js` com Cache First para assets essenciais, rede com fallback.
- Compatível com subdiretórios do GitHub Pages (caminhos relativos `./`).
- `.nojekyll` para desativar Jekyll.
- Banner de instalação PWA customizado.

## Decisão de motor físico

A Fase 2A utiliza um **motor físico próprio** em `src/games/plinko/physics.js`
em vez da biblioteca Matter.js. Motivo: downloads da biblioteca foram truncados
e o motor próprio atende plenamente ao requisito de física real (colisões por
impulso, gravidade, pinos, paredes, dormência) sem dependências externas.
O `vendor/matter.min.js` permanece como placeholder (não utilizado).

## Dependências entre jogos e núcleo

```
Jogos (plinko, cards)  ──usa──>  src/core/wallet.js  ──usa──>  src/core/database.js
        │                              │
        └──usa────────────────────────>┘ (transações, backup, etc.)

Nenhum jogo importa IndexedDB diretamente.
Nenhum jogo modifica saldo diretamente.
```

## Próximas etapas (sem implementar ainda)

- Fase 2B: Card Match Clássico (auditora repositório de referência, implementa independentemente).
- Fase 2C: Card Match Expandido (18/30/48/72/100 cartas).
- Loja, inventário, conquistas, estatísticas (stubs já existem em core/).
