# Memory Quest — Documentação de Arquitetura

## Visão geral
Aplicativo web de memória retrô com carteira virtual compartilhada, loja, inventário,
conquistas, estatísticas, perfil local, cartas personalizadas, backup/restauração,
funcionamento offline e instalação PWA. A partir da Etapa B a identidade de produto é
**Memory Quest**; o repositório continua se chamando **Plinko** e representa toda a
Arcade Collection. Plinko saiu da navegação e da apresentação principal, mas seu
código, física, carteira, transações e arquivos permanecem intactos e o hash legado
`#plinko` continua válido.

A navegação principal tem cinco destinos: **Jogar** (`#cards`), **Perfil**
(`#profile`), **Minhas Cartas** (`#cards` com `data-foco="selfies"`),
**Configurações** (`#settings`) e **Estatísticas** (`#stats`). A loja (`#shop`)
permanece preservada no fluxo legado.

**Estado atual:** o **Jogo da Memória** é a única experiência de cartas acessível.
Ao entrar em `#cards`, o menu abre diretamente na configuração do jogo — não há
seletor de modos, iframe, servidor externo nem dependência de porta adicional. O
repositório de referência avaliado anteriormente permanece intacto apenas como
cópia local fora do projeto; nenhum recurso dele foi copiado, modificado ou
redistribuído aqui.

## Pilha de tecnologia
- HTML5, CSS3, JavaScript moderno com ES Modules (sem build, sem frameworks).
- Plinko: Canvas 2D + motor físico próprio (`physics.js`) + Web Audio procedural.
- Jogo da Memória: DOM/CSS 3D + Web Audio procedural (FX e BGM independentes).
- IndexedDB (banco principal, `DB_VERSION = 2`) + LocalStorage (preferências simples).
- Preferências centralizadas em `src/core/settings.js`, camada sobre a store `settings`
  já existente (sem novo banco; a versão subiu para 2 apenas para acrescentar `selfies`).
- Fotos das Cartas Selfie em `src/core/selfies.js` (store `selfies`, JPEG 320 × 426).
- Perfil local em `src/core/profile.js` e `src/ui/profile.js`, sobre a store `profile`
  já existente; avatar JPEG quadrado de 192 × 192, apenas no dispositivo.
- Painéis de Configurações/Estatísticas em `src/ui/panels.js`.
- Service Worker + Web App Manifest (PWA, offline, cache `memory-quest-v12`, 26 assets).

## Estrutura de pastas
```
arcade-collection/ (raiz do repositório)
├── index.html                 # Página única (SPA leve)
├── manifest.json              # Web App Manifest
├── service-worker.js          # Cache offline + instalação PWA
├── .nojekyll                  # Desativa Jekyll no GitHub Pages
├── styles/main.css            # Estilo retrô global
├── src/
│   ├── app/{main.js,router.js}
│   ├── core/                  # Banco, migrações, carteira, transações, estatísticas, backup, settings, selfies, profile
│   │   ├── migrations.js       # Versão única do esquema (DB_VERSION_ATUAL = 2)
│   │   ├── selfies.js          # CRUD/processamento das Cartas Selfie
│   │   ├── settings.js         # Preferências (modalidade, CHEAT, volumes FX/BGM, selfies, ampliação)
│   │   ├── profile.js          # Perfil local (nome e avatar) na store profile
│   │   └── game-stats.js       # Estatísticas por modalidade e CHEAT
│   ├── games/
│   │   ├── plinko/            # Não modificado nesta etapa
│   │   └── cards/
│   │       ├── index.js          # Ciclo de vida, rotas, áudio e estatísticas do Jogo da Memória
│   │       ├── renderer.js       # UI do Jogo da Memória, menu, galeria/editor e ampliação
│   │       ├── expanded.js       # Configuração do jogo (modalidade, CHEAT, selfies)
│   │       ├── tentativas.js     # Regras puras de tentativas, bônus e CHEAT
│   │       ├── board.js          # Sessão e regras puras do jogo
│   │       ├── cards-data.js     # Símbolos/RNG/layouts usados pelas regras locais
│   │       ├── difficulty.js     # 5 dificuldades do Jogo da Memória
│   │       └── styles.css        # Identidade retrô + HUD/galeria/editor
│   └── ui/
│       ├── components.js       # Componentes visuais compartilhados
│       ├── panels.js           # Painéis de Configurações e Estatísticas
│       └── profile.js          # Painel de Perfil (nome, foto e resumo real)
├── tests/index.test.mjs        # Suíte Node sem dependências (150 testes)
├── docs/                       # ARQUITETURA, DECISOES_TECNICAS, STATUS, GRAPHIFY
└── graphify-out/               # Artefatos regeneráveis (ignorado pelo Git)

Preservados no disco, sem import, sem precache e sem execução (compatibilidade
histórica apenas): `src/games/cards/classic.js` e o módulo adaptador antigo.
O clone de avaliação permanece fora do projeto em:
C:\Users\Samuel\AppData\Local\Temp\opencode\SMB3-Cards-Minigame-ref
```

## Separação núcleo × jogos
Nenhum jogo manipula diretamente o IndexedDB nem altera o saldo. Os serviços centrais
são `wallet.js`, `game-stats.js`, `settings.js`, `selfies.js`, `profile.js`,
`backup.js`, etc. O Jogo da Memória registra partidas apenas por meio de
`registrarPartida({ modo: 'expandido', ... })`; não lê nem escreve carteira.

- `registrarPartida(dados)` — grava uma partida na store `matches` com
  `modalidade`, `cheat`, `derrota`, `bonusSelfies` e `selfiesPares` quando aplicável.
- `obterEstatisticas(jogo, modo)` — agregados usados no menu (Pontuação e Tentativas
  separados; partidas antigas sem `modalidade` são classificadas como Pontuação).
- `contarPartidas(jogo)` — totais exibidos na UI.
- `listarSelfies()` / `criarSelfie()` / `excluirSelfie()` — acesso exclusivo à store
  `selfies`, feito pelo serviço central e não pelo jogo.
- `obterPerfil()` / `salvarPerfil()` — acesso exclusivo à store `profile`, com
  escritas serializadas para duas mudanças rápidas não se sobrescreverem.

## Fluxo do Jogo da Memória

1. Ao entrar em `#cards`, `cardsInit()` cria o renderer e chama `await abrirMenu()`.
2. O menu mostra **JOGO DA MEMÓRIA** com dificuldade, progressão automática,
   visualização das cartas, modalidade, CHEAT (quando aplicável), áudio e galeria.
   Não existe seleção de modos.
3. `iniciarPartida()` cria a sessão com `criarConfigExpandida()`, aplica o áudio e
   mostra o tabuleiro imediatamente — sem fase de apresentação e sem resultado de
   outro jogo.
4. Cada revelação/comparação atualiza o HUD e o snapshot; erros, acertos, pares e
   conclusão são registrados pelos callbacks da sessão.
5. Ao concluir ou esgotar as tentativas, `finalizarPartida()` grava a partida via
   `game-stats.js`, avalia desafios quando há vitória e exibe o resultado com saídas
   para nova partida, configurações e coleção.
6. `cardsDestroy()` encerra a sessão, remove listeners e cancela timers (inclusive o
   da BGM) e o loop RAF.

Os identificadores técnicos internos (`modo: 'expandido'`, `'classico'` em registros
antigos) e as regras/pontuação/dificuldades foram preservados. Nenhum modo
inexistente é exibido na interface; estatísticas legadas permanecem no banco e no
backup, mas a UI apresenta apenas o total do Jogo da Memória
(`porModo.expandido`).

## Visualização ampliada das cartas

A opção **“Visualização das cartas”** fica no menu do Jogo da Memória, ao lado de
dificuldade e progressão. A preferência é lida por `settings.js` no `init()` e
injetada em `config.visualizacaoCartas`; valores inválidos caem no padrão `original`.

| Modo | Comportamento |
|------|---------------|
| `original` | Layout atual, sem área nem sobreposição (padrão para instalações novas e antigas). |
| `fixa` | Área reservada acima do tabuleiro em telas pequenas, com a última carta revelada válida; limpa ao reiniciar/concluir. |
| `temporaria` | Sobreposição ao tocar em carta revelada por 1750 ms; reinicia ao selecionar outra, não bloqueia o tabuleiro e é cancelada ao reiniciar/concluir. |

**Segurança da ampliação:** o renderer usa apenas `snapshot.cartas`, `selecionadas`,
`pareadas` e `simbolos`. Cartas com `revelada === false && pareada === false` nunca
alimentam a área/sobreposição. No modo `temporaria`, tocar em carta já revelada chama
somente a ampliação — `onSelecionar` não é repassado, evitando seleção duplicada.
Nenhuma regra, comparação, cronômetro, tempo alvo, pontuação, desafio ou progressão
passa por esse código.

**Acessibilidade/responsividade:** face 3:4 sem distorção, contraste alto,
`aria-label`/`role=status`/`aria-live`, `prefers-reduced-motion`, foco/teclado/touch
preservados; sobreposição `position: fixed`, `z-index: 80`, `pointer-events: none`.
A troca de preferência é aplicada imediatamente e persistida na store `settings`.

## Modalidades do Jogo da Memória

O menu oferece **Modo Pontuação** (padrão, regras e HUD originais) e
**Modo Tentativas**. A escolha fica em `settings.modalidadeCartas` e vale para novas
partidas. O contador aparece no HUD (`TENTATIVAS: n`, ou `∞` com CHEAT de infinitas).

| Regra | Modo Pontuação | Modo Tentativas |
|-------|----------------|-----------------|
| Erro | Não consome tentativas | Consome 1 tentativa |
| Acerto | Não consome tentativas | Não consome |
| Fim | Conclusão/desafios | Esgotamento ou vitória (derrota registrada) |
| Selfie | Substitui par normal, sem bônus visível | Substitui par normal e concede +2 tentativas |
| Painel de CHEAT | Ausente | Disponível |

Tentativas iniciais por dificuldade (tabela em `tentativas.js`): Fácil 14, Normal 22,
Difícil 32, Muito Difícil 45, Extremo 60. `criarConfigExpandida()` usa
`tentativasPorDificuldade` como fallback; não existe mais `tentativasInicialmente`.

## CHEAT — exclusivo do Modo Tentativas

Preferências em `settings`: `cheatInfinitasCartas`, `cheatPersonalizadaCartas` e
`cheatQuantidadeCartas` (padrão 20, limites 1–999). Prioridade:
**infinitas > personalizada > padrão da dificuldade**. O painel só aparece no Modo
Tentativas; a escolha afeta somente partidas iniciadas depois da alteração. Cada
partida grava `cheat: 'normal' | 'infinitas' | 'personalizada'` nas estatísticas, e
`tentativasInfinitas: true` impede bônus numérico de selfie (o HUD mostra `∞`).

## Cartas Selfie

Galeria acessível pelo destino **Minhas Cartas** (`#cards` com `data-foco="selfies"`),
reaproveitando o renderer existente sem duplicar DOM/estado. A entrada da câmera usa
`capture="user"` como **preferência** pela frontal (o navegador escolhe a câmera real)
e a galeria continua disponível como alternativa. Há preview e controles de
zoom/deslocamento para enquadramento 3:4. Cada arquivo é redimensionado para
320 × 426 px e salvo como JPEG (qualidade 0,82) na store `selfies` (`DB_VERSION = 2`,
índices `createdAt` e `ativa`); limite de origem 20 MB, sem teto artificial de quantidade.
A galeria permite ativar, desativar, substituir e excluir (com confirmação); falhas de
leitura/quota aparecem na própria tela sem descartar o que já foi salvo. O input de
arquivo é anexado ao DOM antes de `click()` para compatibilidade com Safari/iOS.

No baralho, cada selfie ativa substitui **um par normal**: o total de cartas e pares
não muda, cada selfie aparece exatamente 2 vezes e a distribuição é sorteada apenas
em nova partida. O renderer usa `.cards__carta-selfie` com a imagem da face, sem
revelar cartas ocultas. Em Modo Tentativas, cada par de selfie encontrado concede
+2 tentativas (`bonusSelfies` no snapshot; 0 quando o CHEAT é infinitas).

## Áudio independente

FX e BGM do Jogo da Memória são preferências separadas (`fxCartasAtivo`,
`bgmCartasAtiva`, ambas ligadas por padrão) com botões no menu e na partida.
`definirAudio()` aplica o estado sem reiniciar a música quando só o FX muda: o
intervalo da BGM é iniciado/interrompido apenas quando a preferência de BGM muda.
O estado exibido nos botões é a fonte da verdade do toggle, evitando
dessincronização com o motor de áudio. O som final da partida é tocado uma única
vez pelos callbacks (`tocarSom: false` em `mostrarResultado`).

## Volumes de FX e BGM

Além dos ligadores, cada canal tem seu próprio volume em `volumeFxCartas` e
`volumeBgmCartas`, campos aditivos no registro `id: 1` da store `settings`. Padrões:
**FX 80%** e **BGM 65%**, aplicados apenas quando o campo não existe — leitura antiga
não grava nem cria store. `normalizarVolumeCartas()` aceita `0` como silêncio, limita
a `0–100` e arredonda; valores inválidos caem no padrão do canal.

Os sliders aparecem no menu do Jogo da Memória e no painel de Configurações, com
rótulo em tempo real. Cada voz usa amplitude procedural própria antes do volume do
usuário: FX `0,025 × 80% = 0,02` e BGM `0,05 × 65% = 0,0325` (antes a base da BGM
era `0,014`, inaudível em celulares). O limite por voz é `0,08` e o barramento
principal usa ganho `0,9` com um `DynamicsCompressorNode` opcional como limitador
(`threshold -6`, `knee 0`, `ratio 20`, `attack 0.003`, `release 0.25`); navegadores
sem esse nó mantêm o caminho de ganho simples. Assim a BGM em 100% chega a `0,05`,
sem clipping, distorção ou saturação. Volume `0` retorna sem tocar; alterar apenas o
volume **não recria o timer** da BGM. Como duas mudanças rápidas poderiam ler o mesmo
registro antigo, as escritas de `settings.js` são serializadas por uma fila e um
teste de regressão cobre o caso FX `0` + BGM `100`.

## Identidade, navegação e estilo

`index.html`, `manifest.json` e o SW passaram a usar **Memory Quest**. A navegação
inferior mobile troca Plinko por cinco destinos, com alvos de toque de 52 px e
botões `btn--arcade` com borda 3D/pixel, sombra, estados pressed/selected/focus/
disabled e ícones decorativos em `styles/main.css`. O bloco é escopado ao Jogo da
Memória. Rotas legadas (`#plinko`, `#shop`) continuam válidas no router; Plinko não
foi alterado.

## Perfil local e estatísticas reais

O painel `#profile-board` (em `src/ui/profile.js`) lê/escreve a store `profile` já
existente por meio de `src/core/profile.js`. Nome (até 60 caracteres) e avatar JPEG
192 × 192 ficam apenas no dispositivo; `capture="user"` documenta a preferência pela
câmera frontal e “Escolher da galeria” permanece. `salvarPerfil()` preserva `id`,
`criadoEm`, `idExterno`, `tema` e demais campos antigos, serializa escritas e não cria
store nem bump de DB. O resumo usa `contarPartidas()`, `obterEstatisticas()` e
`getEstado()` — números reais de `matches` e da carteira, sem estado paralelo. O
cabeçalho legado `#profile-nome`/`#profile-id`/`.profile__avatar-placeholder` é
sincronizado, e após restaurar backup o painel é renderizado novamente.

## Regras, dificuldades e pontuação do Jogo da Memória

| Aspecto | Comportamento preservado |
|---------|--------------------------|
| Cartas / pares | 18/9, 30/15, 48/24, 72/36, 100/50 (selfies substituem pares) |
| Disposição | Fisher-Yates por partida |
| Dificuldade | 5 níveis, progressão automática opcional |
| Modalidade | Pontuação (padrão) ou Tentativas (+ CHEAT exclusivo) |
| Apresentação | Nenhuma |
| Resultado | Desafios e estatísticas por modalidade/CHEAT |
| Áudio | Web Audio procedural, FX e BGM independentes com volumes próprios |
| Economia | Nenhuma |

As regras, a pontuação, as dificuldades, os símbolos, as animações e as estatísticas
foram integralmente preservados. Nenhuma moeda é concedida por abrir ou trocar de jogo,
e nenhum contador numérico de pontos ou bônus `+50` foi introduzido.

## Persistência local e navegação

- IndexedDB: stores `profile`, `wallet`, `transactions`, `games`, `matches`,
  `inventory`, `achievements`, `settings`, `metadata` e `selfies`; `DB_VERSION = 2`.
  A versão única está em `migrations.js` (`DB_VERSION_ATUAL`), importada por
  `database.js` para evitar números divergentes.
- A migração v1 → v2 é aditiva: cria somente `selfies`; nenhuma store/registro é
  recriado ou apagado. O seed inicial roda apenas quando `oldVersion < 1` (com
  `undefined` tratado como 0), preservando perfis, carteiras e preferências antigos.
- `settings.js` acrescenta `visualizacaoCartas`, `modalidadeCartas`,
  `cheatInfinitasCartas`, `cheatPersonalizadaCartas`, `cheatQuantidadeCartas`,
  `fxCartasAtivo`, `bgmCartasAtiva`, `volumeFxCartas`, `volumeBgmCartas` e
  `selfiesAtivas` ao registro `id: 1` da store `settings`, preservando os demais
  campos. Normalizadores rejeitam valores inválidos com fallback seguro e falhas de
  storage não quebram o jogo. Escritas são serializadas para evitar corrida.
- `profile.js` usa somente campos já existentes (`nome`, `avatar`, `idExterno`,
  `tema`, `criadoEm`, `atualizadoEm`) na store `profile`; nenhum campo/store novo e
  nenhuma mudança de `DB_VERSION_ATUAL = 2`.
- Router por hash aceita `#home`, `#plinko`, `#cards`, `#shop`, `#profile`,
  `#settings` e `#stats`. A navegação principal expõe cinco destinos; `plinko` e
  `shop` seguem válidos por hash/legado. `data-foco="selfies"` abre a galeria
  existente em `#cards`.
- `main.js` chama `cardsInit()`/`cardsDestroy()` ao entrar/sair; `destroy()` remove
  os listeners de teclado/selfie e cancela os timers da partida, da ampliação e da
  BGM via `encerrarSessao()`/`pararLoop()`. Entrar em `#profile` e restaurar backup
  também renderiza o painel de perfil.
- Service Worker `memory-quest-v12`: precacheia 26 assets, incluindo `profile.js`,
  `panels.js`, `settings.js`, `selfies.js`, `game-stats.js`, `tentativas.js`,
  `styles.css` e os módulos ativos de cartas. Os dois módulos legados preservados no
  disco não entram no precache. O nome foi promovido de `arcade-collection-v4` para
  `memory-quest-v5` (Etapa B), `v7` (D), `v9` (E), `v10` (F), `v11` (ajustes finais) e
  `v12` (remoção do mecanismo temporário) para servir sempre o JS atual e expurgar
  caches antigos na ativação. A publicação foi autorizada e enviada a `origin/main`.

## Regras obrigatórias preservadas
1. Nenhum jogo manipula banco ou saldo diretamente.
2. Transações financeiras atômicas, saldo nunca negativo, idempotência.
3. Nenhuma moeda concedida por abrir/trocar de jogo.
4. Jogo da Memória sem cobrança, sem prêmio e sem transações; sem contador numérico de
   pontos e sem bônus `+50` visível.
5. Conquistas, carteira, Plinko, regras, dificuldades, cartas, selfies, animações e
   estatísticas inalterados. O banco passou de v1 para v2 de forma estritamente
   aditiva, sem apagar dados.
6. Listeners, timers (ampliação, sessão, BGM) e o loop RAF cancelados ao sair da área
   ou finalizar a partida.
7. Cada selfie ativa substitui exatamente um par, sem alterar total de cartas/pares;
   fotos ficam apenas no dispositivo, na store `selfies` local.
8. Identidade visível trocada para Jogo da Memória, mas identificadores técnicos
   preservados (`ArcadeCollection`, v2, hashes legados, `dificuldadePlinko`).
9. Volumes, perfil, estatísticas e backup continuam nos registros/stores existentes,
   com formato de backup `1.0.0` inalterado e nenhum dado apagado.
10. Nenhum iframe, nenhum servidor adicional e nenhum módulo legado no fluxo ativo ou
    no precache do Service Worker.

## Licença e distribuição
O projeto não incorpora código, sprites, áudios, fontes ou títulos de terceiros. O
clone avaliado fora do repositório permanece intacto e não é redistribuído. A
autorização expressa para commit e push foi concedida nesta etapa; nenhum deploy ou
outra forma de publicação adicional foi executada.

## Dependências verificadas
Graphify após a remoção final: **512 nós, 1503 arestas, 17 comunidades, nenhum ciclo
de importação**. Extração 97% / inferida 3% (47 arestas, confiança média 0,85). God nodes:
`criarRenderer()` 47 arestas, `grupoCardMatch()` 32, `getAll()` 28, `grupoBanco()` 23,
`grupoVisualizacaoCartas()` 23, `grupoPreferenciasEStats()` 23, `init()` 23,
`grupoVolumes()` 22, `put()` 22 e `grupoSelfies()` 22.
O único arquivo sem símbolos extraídos continua sendo `vendor/matter.min.js`
(placeholder preexistente e não usado). `cards/index.js` segue sem aresta para
`wallet.js`. Os módulos legados preservados no disco não participam do fluxo ativo.

## Próximas etapas
1. Validar em dispositivo Android real (Moto G35); `adb` não está disponível no ambiente.
2. Avaliar o overflow horizontal preexistente do cabeçalho (`header__wallet`) em 360 px,
   fora do escopo do Jogo da Memória (o tabuleiro em si não transborda).
3. Definir economia do Jogo da Memória (atualmente inexistente).
4. Acompanhar a disponibilização do `origin/main` no GitHub Pages, se aplicável.
