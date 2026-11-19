# Memory Quest

Jogo de memória retrô, local e offline, executado no navegador. O projeto vive no
repositório **Plinko** (`https://github.com/zappazero8019/Plinko`), que também
conserva o jogo Plinko legado e sua economia própria.

- **Memory Quest:** experiência principal, com cartas, progressão, selfies,
  perfil local, estatísticas e economia isolada.
- **Plinko:** preservado fora da navegação principal, acessível pelo hash
  `#plinko`. Não compartilha economia com o Memory Quest.

Este README é a documentação oficial do estado atual do projeto. Os arquivos em
`docs/` são registros históricos das etapas de desenvolvimento e podem conter
números defasados (versão do cache, versão do banco, contagem de testes).

---

## Apresentação

O Memory Quest é um jogo de encontrar pares em um tabuleiro de cartas. O
objetivo é concluir todas as combinações da dificuldade escolhida antes de
esgotar as tentativas, acumulando pontos e moedas conforme a sequência de acertos.
A dificuldade avança automaticamente após vitórias legítimas, quando a
progressão estiver ativada.

A identidade visual é **Pixel Art / Retro Gaming**: cores de arcade, tipografia
monoespaçada, molduras simples, HUD com indicadores e feedback sonoro opcional.
Toda a interface é feita com HTML, CSS e JavaScript nativos, sem bibliotecas de
interface ou gráficos.

O aplicativo funciona sem conexão após o primeiro carregamento, por meio de um
Service Worker, e pode ser instalado como PWA quando o navegador oferecer o
suporte.

---

## Funcionalidades

### Modos de jogo

Há uma experiência ativa de **Jogo da Memória (modo expandido)** com duas
modalidades selecionáveis em Configurações:

- **Pontuação** (padrão): foco em sequências, tempo e dificuldade.
- **Tentativas:** limite de erros por dificuldade e bônus de vitória.

Os módulos clássicos/SMB3 permanecem no repositório como legado, sem entrada na
navegação principal.

### Cinco níveis de dificuldade e tamanhos de baralho

| Dificuldade | Cartas | Pares | Tentativas iniciais | Prévia | Tempo alvo |
|-------------|-------:|------:|--------------------:|-------:|-----------:|
| Fácil       | 18     | 9     | 14                 | 3 s    | 60 s      |
| Normal      | 30     | 15    | 22                 | 4 s    | 110 s     |
| Difícil     | 48     | 24    | 32                 | 5 s    | 180 s     |
| Muito difícil | 72   | 36    | 45                 | 6 s    | 280 s     |
| Extremo     | 100    | 50    | 60                 | 8 s    | 420 s     |

A prévia das cartas é obrigatória e **não entra no cronômetro oficial**: o tempo
e as tentativas só começam a valer depois que a apresentação termina.

### Progressão automática

Ativada por padrão, avança uma dificuldade a cada vitória legítima. A progressão
não é cíclica: Extremo permanece em Extremo. Pode ser desligada em
Configurações; nesse caso a dificuldade escolhida fica fixa.

### Pontuação, moedas e multiplicadores

- Sequências de acertos geram multiplicadores e pontuação.
- As moedas pertencem a uma carteira isolada do Memory Quest, exibida dentro do
  jogo, distinta da carteira legada do Plinko mostrada no cabeçalho.
- Bônus de tentativas e desafios/conquistas são avaliados ao final da partida.

### Conquistas

Quatro desafios são avaliados ao final de cada vitória legítima e gravados no
registro da partida: **nenhum par errado**, **no máximo 2 erros**, **concluir
dentro do tempo alvo** e **precisão total** (tantas tentativas quanto pares).
Vitórias com CHEAT não recebem desafios.

### Selfies e Minhas Cartas

Fotos tiradas ou escolhidas no dispositivo são armazenadas localmente como
imagens pequenas. Cada selfie ativa **substitui** um par comum do baralho; o
total de cartas e pares da dificuldade não muda. Encontrar um par de selfie
concede +2 tentativas.

### Perfil local

Nome, avatar e tema são guardados apenas neste dispositivo. O perfil pode ser
redefinido e a identidade pode ser excluída de forma pontual, com confirmação
explícita.

### Estatísticas e gráficos

A área Estatísticas lê somente partidas e transações já persistidas. Mostra
resumo, evolução das últimas 12 partidas concluídas, taxa de vitórias por
dificuldade e moedas creditadas. Quando não há histórico, a interface informa a
ausência de dados em vez de exibir zeros fictícios. Os gráficos são feitos com
DOM/CSS, sem dependências externas.

### Configurações de áudio e visual

Volumes independentes para efeitos (padrão 80) e música (padrão 65),
alternância de FX/BGM, modalidade, dificuldade inicial, progressão, CHEAT e
três modos de ampliação da carta revelada:

- **Original:** sem ampliação adicional.
- **Área fixa:** a carta aparece em um painel de tamanho estável.
- **Temporária:** a ampliação aparece por alguns segundos e desaparece.

O tamanho vai de **100% a 150%**, em passos de **5%**, com padrão de **120%**.
A preferência é persistida e pode ser alterada durante a partida, sem recriar o
tabuleiro, reiniciar a rodada ou mover cartas.

### Backup e restauração

Exportação e importação de um arquivo `.json` com todas as stores do navegador.
A importação exige confirmação explícita, valida a estrutura e preserva dados de
versões anteriores.

---

## Regras do jogo

### Tentativas

- Cada dificuldade começa com o número de tentativas da tabela acima.
- **Erros consomem uma tentativa**; acertos não consomem.
- Cada par de selfie encontrado devolve **+2 tentativas**, uma vez por par.
- Ao esgotar as tentativas, a partida termina em derrota.
- As opções de CHEAT alteram as tentativas iniciais, nesta ordem de prioridade:
  **infinitas** → **personalizada** → **padrão da dificuldade**.

### Sequências e multiplicadores

A sequência começa em 1 no primeiro par e aumenta a cada acerto. Um erro zera a
sequência. O multiplicador da posição `n` é:

```
min(2^(n - 1), 16)
```

Ou seja: x1, x2, x4, x8 e x16 a partir do quinto par consecutivo, com teto de
x16.

### Pontuação

A pontuação é calculada como:

```
P = B × Fd × Fe × Ft
B = 100 × soma dos multiplicadores dos pares encontrados
Fd = 1 / 1,25 / 1,5 / 1,75 / 2 (Fácil a Extremo)
Fe = 0,5 + 0,5 × (pares / tentativas), limitado a [0,5 ; 1]
Ft = 1,25 − 0,25 × (tempo / tempo alvo), limitado a [0,75 ; 1,25]
```

O resultado é arredondado e nunca negativo.

### Bônus por vitória

Existe apenas na **modalidade Tentativas** e somente em caso de vitória:

```
bônus = teto da dificuldade × (tentativas restantes / tentativas iniciais)
```

Tetos: Fácil 18, Normal 60, Difícil 144, Muito difícil 288, Extremo 500.
O valor é arredondado. Vitórias com CHEAT não recebem bônus.

### Recompensas em derrota

A derrota **não zera tudo**: as moedas dos pares efetivamente encontrados são
creditadas normalmente. Não há bônus de tentativas, não há avanço de dificuldade
e os desafios não são concedidos. A partida é registrada como concluída, com
`vitoria = false`.

### Abandono e reinício

Reiniciar, abrir o menu ou sair da área **não registra partida, não credita
moedas e não liquida recompensas**. O rastreador da rodada é descartado, timers
e callbacks pendentes são cancelados e nenhum par visto antes da virada entra no
cálculo.

### CHEAT

Qualquer CHEAT ativado — infinitas ou quantidade personalizada — torna a partida
**inelegível para sempre naquela sessão**, mesmo que a opção seja desligada
depois. Nesse caso:

- moedas, bônus e pontuação viram zero;
- a progressão e os desafios não são concedidos;
- a liquidação grava uma transação de bloqueio com quantidade zero.

---

## Economia

O Memory Quest possui economia **independente do Plinko**. Os módulos da economia
do Memory Quest não importam `wallet.js` nem `transactions.js`; saldo, histórico
e idempotência vivem nas stores `mqWallet`, `mqTransactions` e `mqSessions`.

### Moedas-base por dificuldade

Por par efetivamente encontrado:

| Dificuldade | Moedas por par |
|-------------|---------------:|
| Fácil       | 1              |
| Normal      | 2              |
| Difícil     | 3              |
| Muito difícil | 4            |
| Extremo     | 5              |

As moedas de pares são `moedas-base × soma dos multiplicadores`, arredondadas.

### Condições de liquidação

- Somente uma partida finalizada (vitória ou derrota por esgotamento) chega à
  liquidação; abandono e reinício não chegam.
- A liquidação é atômica: leitura da carteira, verificação da sessão e escritas
  acontecem na mesma transação do IndexedDB.
- A proteção contra duplicidade usa `mqSessions.sessionId` com índice único.
  Cliques repetidos, callbacks atrasados ou navegação não creditam duas vezes.
- Pares e bônus da mesma sessão podem conviver no histórico; a idempotência é
  garantida pela sessão, não por um índice único em `mqTransactions.sessionId`.
- Chamadas repetidas com o mesmo `sessionId` retornam `duplicado` e não alteram
  o saldo.

### Persistência local

Não há servidor: saldo, transações, sessões liquidadas, estatísticas, preferências
e perfis ficam no IndexedDB do navegador (`ArcadeCollection`, versão 4, 13
stores). O banco solicita persistência quando o navegador permite.

---

## Dados e privacidade

- Tudo é guardado localmente no **IndexedDB**. Não há backend, contas nem
  sincronização automática entre dispositivos.
- **Perfil local:** nome, avatar e tema. A foto é reduzida a uma data URL JPEG
  pequena e nunca sai do dispositivo.
- **Selfies locais:** imagens usadas como cartas, também apenas neste dispositivo.
- **Exclusão do perfil:** apaga somente nome, avatar selecionado e foto, após
  confirmação explícita. Preserva estatísticas, histórico, conquistas,
  progressão, selfies, configurações, carteira e transações do Memory Quest,
  dados do Plinko e backups. Um novo nome recria a identidade; não há limpeza
  completa automática.
- **Backup/restauração:** o arquivo JSON usa formato `1.0.0`. Backups antigos com
  versões de banco 1 a 4 são aceitos; stores introduzidas depois são preservadas
  quando ausentes no arquivo. A carteira isolada do Memory Quest é normalizada
  para o ID canônico `1`, evitando carteiras duplicadas na restauração.
- O Service Worker remove apenas caches antigos. Ele não apaga dados locais.

---

## Arquitetura

| Caminho | Responsabilidade |
|---------|------------------|
| `index.html` | Estrutura da SPA, navegação principal e áreas legadas |
| `manifest.json` / `service-worker.js` | PWA, precache offline e estratégia de cache |
| `styles/main.css` | Identidade visual global e painéis |
| `src/app/main.js` | Inicialização, banco, carteira do cabeçalho, backup, PWA e ciclo de vida das áreas |
| `src/app/router.js` | Navegação por hash: `home`, `cards`, `profile`, `settings`, `stats`, `plinko`, `shop` |
| `src/core/database.js` / `migrations.js` | IndexedDB, transações, integridade e migrações v1 → v4 |
| `src/core/wallet.js` / `transactions.js` | Carteira e histórico **legados do Plinko** |
| `src/core/mq-economy.js` | Economia isolada do Memory Quest e liquidação idempotente |
| `src/core/game-stats.js` / `stats-insights.js` | Registro de partidas e leituras derivadas para os gráficos |
| `src/core/settings.js` | Preferências persistidas e observadores de mudança |
| `src/core/profile.js` / `selfies.js` | Perfil local e imagens das cartas personalizadas |
| `src/core/backup.js` | Exportação, validação e importação de backups |
| `src/games/cards/index.js` | Orquestração da partida, eventos, sessão e economia na tela |
| `src/games/cards/board.js` | Regras puras da sessão e do tabuleiro |
| `src/games/cards/expanded.js` | Configuração do modo expandido e desafios |
| `src/games/cards/difficulty.js` | Dificuldades, tamanhos de baralho e prévia |
| `src/games/cards/tentativas.js` | Tentativas, prioridade do CHEAT e bônus de selfie |
| `src/games/cards/recompensas.js` | Rastreador de elegibilidade e recompensas da rodada |
| `src/games/cards/previa.js` | Controle da apresentação obrigatória das cartas |
| `src/games/cards/renderer.js` / `styles.css` | Menu, HUD, tabuleiro, galeria e ampliação |
| `src/games/cards/cards-data.js` | Símbolos, embaralhamento e layouts |
| `src/ui/panels.js` / `charts.js` / `profile.js` / `components.js` | Painéis de Configurações, Estatísticas, Perfil e componentes comuns |
| `src/games/plinko/` | Jogo Plinko legado: física, renderização Canvas, dificuldades e recompensas |
| `tests/index.test.mjs` | Suíte automatizada em Node, sem dependências |
| `docs/` | Registros históricos das etapas anteriores |

---

## Execução local

Requisitos verificados neste ambiente: **Python 3.14.6** (`py`) e **Node 24.18.1**.
Não é necessário instalar pacotes para rodar o projeto.

No Windows PowerShell:

```powershell
Set-Location "C:\Users\Samuel\Documents\Plinko"
py -m http.server 8770 --bind 0.0.0.0
```

Depois abra no navegador:

```
http://localhost:8770/index.html
```

Para acessar de outro dispositivo na mesma rede, use o IP da máquina no lugar de
`localhost`, por exemplo `http://192.168.1.10:8770/index.html`. O firewall do
Windows pode pedir permissão para o Python escutar na rede.

Use um servidor HTTP em vez de abrir `index.html` diretamente do disco: módulos
ES e Service Worker exigem origem HTTP. O Service Worker também requer `localhost`
ou HTTPS.

---

## Testes

```bash
node tests/index.test.mjs
```

A suíte usa um DOM simulado em Node e não instala dependências. Ela verifica,
entre outros pontos:

- regras puras de cartas, dificuldades, tentativas, CHEAT e pontuação;
- economia isolada, liquidação atômica e proteção contra duplicidade;
- migrações do banco, exportação/importação de backup e compatibilidade com
  versões antigas;
- normalização de preferências, exclusão de perfil e preservação dos demais
  dados;
- agregações de estatísticas, estados vazios e gráficos;
- ampliação nos três modos, inclusive sem deslocar cartas nem recriar o
  tabuleiro;
- auditoria do Service Worker e das referências de precache.

Resultado verificado na última execução: **207 testes aprovados, 0 falhas**.

A suíte **não** substitui teste em navegador real, inspeção visual, instalação
PWA, testes de toque em dispositivo físico nem medição de desempenho.

---

## Preservação do Plinko

O Plinko permanece no projeto com sua física, renderização Canvas, dificuldades,
carteira e transações legadas. A rota `#plinko` continua válida e o módulo é
inicializado ao entrar nessa área. A loja legada também continua acessível por
`#shop`. Um problema já identificado na restauração da carteira legada do Plinko
permanece como tarefa independente e não foi alterado aqui.

As economias são separadas: o cabeçalho exibe a carteira legada, enquanto o
saldo do Memory Quest aparece dentro do Jogo da Memória.

---

## Limitações conhecidas

- Não há sincronização em nuvem, contas nem backup automático: a troca de
  dispositivo depende de exportar e importar o JSON.
- As estatísticas só consideram partidas que passaram por `finalizarPartida()`.
  Abandono e reinício não entram no histórico; derrota é inferida de partidas
  concluídas sem vitória.
- O campo econômico enviado ao registrar uma partida não é persistido na store
  `matches`; os gráficos de moedas usam as transações efetivamente gravadas.
- O contador "Conquistas" da tela inicial conta quantos dos quatro desafios
  conhecidos foram concluídos ao menos uma vez em vitória legítima, lendo
  `matches.desafios`. IDs repetidos, desconhecidos ou incompletos são ignorados.
- Os ícones PWA em `assets/icons/` existem nas oito dimensões do manifesto, com
  versões `any` e `maskable`. A instalação depende dos critérios do navegador.
- O layout foi verificado por métricas programáticas em 360 px e em navegador
  desktop. Não houve inspeção visual automatizada por modelo nem validação
  física recente no Moto G35 / Android 15.
