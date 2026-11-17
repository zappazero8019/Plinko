/**
 * games/plinko/index.js — Jogo Plinko completo (FASE 2A)
 *
 * Motor físico próprio (physics.js) + renderer Canvas 2D (renderer.js).
 * Integração com a carteira central EXCLUSIVAMENTE via API (addCoins /
 * debitCoins / getSaldo / validarRecompensa). Nunca toca IndexedDB nem
 * altera o saldo diretamente.
 *
 * Funcionalidades:
 *  - 4 dificuldades (Fácil 8, Normal 12, Difícil 14, Extremo 16 fileiras)
 *  - Apostas virtuais com saldo compartilhado
 *  - Colisões reais (bolinha-pino, bolinha-parede, bolinha-bolinhas)
 *  - Compartimentos de premiação com multiplicadores
 *  - Efeitos sonoros (Web Audio API) e visuais (partículas)
 *  - Histórico de jogadas (via carteira)
 */

import { getSaldo, debitCoins, addCoins, validarRecompensa } from '../../core/wallet.js';
import { World, createPin, createWall, createBall, Vec } from './physics.js';
import { PlinkoRenderer } from './renderer.js';
import { DIFICULDADES_PLINKO } from './difficulty.js';

// ============================================================================
// Áudio — Web Audio API (sons gerados proceduralmente, sem arquivos externos)
// ============================================================================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

function ensureAudio() {
  if (!audioContext && AudioCtx) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTone(freq, type = 'square', duration = 0.1, vol = 0.1) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

function playLaunch() {
  // Som de lançamento: subida rápida
  playTone(220, 'square', 0.08, 0.12);
  setTimeout(() => playTone(330, 'square', 0.08, 0.1), 60);
}

function playPinHit() {
  // Som de colisão com pino: clique curto e agudo
  playTone(600 + Math.random() * 200, 'square', 0.04, 0.06);
}

function playPrize(multiplier) {
  // Som de prêmio: tom mais alto quanto maior o multiplicador
  const base = 400 + multiplier * 60;
  playTone(base, 'triangle', 0.25, 0.15);
  setTimeout(() => playTone(base * 1.5, 'triangle', 0.25, 0.15), 120);
}

function playError() {
  playTone(150, 'sawtooth', 0.2, 0.15);
}

// ============================================================================
// Partículas (efeito visual de premiação)
// ============================================================================

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 60 + 20;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.color = color;
    this.life = 1.0;
    this.decay = Math.random() * 0.02 + 0.015;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 400 * dt; // gravidade leve nas partículas
    this.vx *= 0.96;
    this.vy *= 0.96;
    this.life -= this.decay;
    return this.life > 0;
  }
  draw(ctx) {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - 1.5, this.y - 1.5, 3, 3);
    ctx.globalAlpha = 1;
  }
}

// ============================================================================
// Jogo
// ============================================================================

const PLINKO_AREA_ID = 'area-plinko';
const BOARD_ID = 'plinko-board';

let world = null;
let renderer = null;
let balls = [];
let particles = [];
let isLaunching = false;
let lastTime = 0;
let animFrame = null;

// Estado da sessão (não é saldo, apenas UI)
let currentDifficulty = 'normal';
let currentBet = 1;

const UI = {
  betDisplay: null,
  diffBtns: {},
  launchBtn: null,
  msg: null,
  historyList: null,
  saldoDisplay: null
};

function $id(id) { return document.getElementById(id); }

/**
 * Inicializa o jogo na área do Plinko.
 */
export function init() {
  const board = $id(BOARD_ID);
  if (!board) return;

  // Monta HTML do tabuleiro
  board.innerHTML = `
    <div class="plinko-game">
      <div class="plinko__controls">
        <div class="plinko__difficulty" role="group" aria-label="Dificuldade">
          <button class="diff-btn active" data-diff="normal">Normal (12)</button>
          <button class="diff-btn" data-diff="facil">Fácil (8)</button>
          <button class="diff-btn" data-diff="dificil">Difícil (14)</button>
          <button class="diff-btn" data-diff="extremo">Extremo (16)</button>
        </div>
        <div class="plinko__bet">
          <label>Aposta</label>
          <div class="plinko__bet-controls">
            <button id="plinko-bet-minus">−</button>
            <span id="plinko-bet-value">1</span>
            <button id="plinko-bet-plus">+</button>
          </div>
          <div id="plinko-saldo">Saldo: <span>0</span> 🪙</div>
        </div>
      </div>
      <canvas id="plinko-canvas" class="plinko__canvas"></canvas>
      <div class="plinko__feedback" id="plinko-feedback" aria-live="polite"></div>
      <button id="plinko-launch" class="plinko__launch">LANÇAR BOLINHA</button>
      <div class="plinko__history">
        <h4>Histórico</h4>
        <ul id="plinko-history"></ul>
      </div>
    </div>
  `;

  // Referências UI
  UI.betDisplay = $id('plinko-bet-value');
  UI.saldoDisplay = $id('plinko-saldo').querySelector('span');
  UI.launchBtn = $id('plinko-launch');
  UI.msg = $id('plinko-feedback');
  UI.historyList = $id('plinko-history');

  $id('plinko-bet-minus').addEventListener('click', () => setBet(currentBet - 1));
  $id('plinko-bet-plus').addEventListener('click', () => setBet(currentBet + 1));
  UI.launchBtn.addEventListener('click', () => launchBall());

  $id('plinko-bet-minus').addEventListener('touchstart', (e) => { e.preventDefault(); setBet(currentBet - 1); }, { passive: false });
  $id('plinko-bet-plus').addEventListener('touchstart', (e) => { e.preventDefault(); setBet(currentBet + 1); }, { passive: false });
  UI.launchBtn.addEventListener('touchstart', (e) => { e.preventDefault(); launchBall(); }, { passive: false });

  // Dificuldades
  const diffBtns = board.querySelectorAll('.diff-btn');
  diffBtns.forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); setDifficulty(btn.dataset.diff); }, { passive: false });
  });
  UI.diffBtns = {};
  diffBtns.forEach(btn => { UI.diffBtns[btn.dataset.diff] = btn; });

  // Renderer e física
  const canvas = $id('plinko-canvas');
  renderer = new PlinkoRenderer(canvas);
  world = new World({ gravityX: 0, gravityY: 700, substeps: 8 });
  _buildPinsAndWalls();

  // Loop de animação
  lastTime = performance.now();
  animFrame = requestAnimationFrame(loop);

  // Atualiza UI inicial
  updateSaldoUI();
  setBet(1);
}

/**
 * Reconstrói pinos e paredes conforme dificuldade.
 */
function _buildPinsAndWalls() {
  if (!renderer) return;
  const diff = DIFICULDADES_PLINKO[currentDifficulty] || DIFICULDADES_PLINKO.normal;
  renderer.setDifficulty(diff.fileiras);

  // Recria paredes e pinos no mundo físico (limpa corpos antigos exceto se houver bolas)
  // Para simplicidade, recria o mundo quando muda dificuldade
  world = new World({ gravityX: 0, gravityY: 750, substeps: 8 });
  world.onCollision = (col) => {
    // Efeito sonoro em colisão com pino
    if (col.bodyA.label === 'ball' || col.bodyB.label === 'ball') {
      playPinHit();
    }
  };

  const cx = renderer.width / 2;
  const top = 40 * renderer.scale;
  const bottom = renderer.height - 60 * renderer.scale;
  const halfW = (renderer.width - 40 * renderer.scale) / 2;

  // Paredes
  createWall(world, cx - halfW * 0.1, top + 10, -Math.PI / 2, bottom - top - 20);
  createWall(world, cx + halfW * 0.1, top + 10, Math.PI / 2, bottom - top - 20);

  // Pinos
  const pinRadius = 5 * renderer.scale;
  const rowSpacing = (bottom - top - 40 * renderer.scale) / Math.max(diff.fileiras - 1, 1);
  const colSpacing = (halfW * 1.6) / Math.max(diff.fileiras, 1);
  let pinId = 1000;
  for (let r = 0; r < diff.fileiras; r++) {
    const y = top + 30 * renderer.scale + r * rowSpacing;
    const pinCount = r + 1;
    const startX = cx - (pinCount - 1) * colSpacing * 0.5;
    for (let c = 0; c < pinCount; c++) {
      createPin(world, startX + c * colSpacing, y, pinRadius);
      pinId++;
    }
  }

  // Atualiza renderer com pinos/paredes físicos
  renderer.pins = world.getBodies()
    .filter(b => b.label === 'pin')
    .map(b => ({ x: b.position.x, y: b.position.y, radius: b.radius }));
  renderer.walls = world.getBodies()
    .filter(b => b.label === 'wall')
    .map(b => {
      const dir = Vec.create(Math.cos(b.angle), Math.sin(b.angle));
      const half = b.radius;
      return {
        x1: b.position.x - dir.x * half,
        y1: b.position.y - dir.y * half,
        x2: b.position.x + dir.x * half,
        y2: b.position.y + dir.y * half
      };
    });
  renderer.draw();
}

/**
 * Define a dificuldade.
 */
async function setDifficulty(diff) {
  if (!DIFICULDADES_PLINKO[diff]) return;
  currentDifficulty = diff;

  // Atualiza botões
  Object.entries(UI.diffBtns).forEach(([key, btn]) => {
    btn.classList.toggle('active', key === diff);
  });

  // Para bolas em movimento e recria tabuleiro
  stopBalls();
  _buildPinsAndWalls();
  showMsg(`Dificuldade: ${DIFICULDADES_PLINKO[diff].label}`);
  await updateSaldoUI();
}

/**
 * Define o valor da aposta.
 */
function setBet(val) {
  const min = 1;
  const max = 100;
  currentBet = Math.min(Math.max(val, min), max);
  if (UI.betDisplay) UI.betDisplay.textContent = currentBet;
}

/**
 * Atualiza o display de saldo (leitura apenas).
 */
async function updateSaldoUI() {
  const saldo = await getSaldo();
  if (UI.saldoDisplay) UI.saldoDisplay.textContent = saldo;
}

/**
 * Mostra mensagem temporária.
 */
function showMsg(text, ms = 2500) {
  if (!UI.msg) return;
  UI.msg.textContent = text;
  UI.msg.style.opacity = 1;
  setTimeout(() => { UI.msg.style.opacity = 0; }, ms);
}

/**
 * Para todas as bolas e limpa o mundo.
 */
function stopBalls() {
  isLaunching = false;
  balls = [];
  if (renderer) renderer.setBalls([]);
  if (world) {
    // Remove apenas bolas do mundo (mantém pinos e paredes)
    const toRemove = world.getBodies().filter(b => b.label === 'ball');
    toRemove.forEach(b => world.remove(b));
  }
}

/**
 * Lança uma bolinha se houver saldo.
 */
async function launchBall() {
  if (isLaunching) return;

  const saldo = await getSaldo();
  if (saldo < currentBet) {
    playError();
    showMsg('Saldo insuficiente para a aposta.');
    return;
  }

  // Debita a aposta via carteira central (atômico)
  const debito = await debitCoins(currentBet, {
    origem: 'plinko',
    descricao: `Aposta Plinko (${DIFICULDADES_PLINKO[currentDifficulty].label})`,
    jogo: 'plinko',
    idempotencyKey: `plinko_bet_${Date.now()}_${Math.random().toString(36).slice(2)}`
  });

  if (!debito.ok) {
    playError();
    showMsg(debito.erro === 'saldo_insuficiente' ? 'Saldo insuficiente' : 'Erro na aposta.');
    return;
  }

  playLaunch();
  isLaunching = true;
  UI.launchBtn.disabled = true;
  UI.launchBtn.textContent = 'FÍSICA EM EXECUÇÃO...';
  showMsg('Bolinha em queda...');

  // Cria a bolinha na física
  const cx = renderer.width / 2;
  const top = 40 * renderer.scale;
  const ball = createBall(world, cx + (Math.random() - 0.5) * 8, top - 20, 6 * renderer.scale, 0.45);
  ball.userData = { bet: currentBet, launchedAt: performance.now() };
  balls = [ball];
  if (renderer) renderer.setBalls(balls.map(b => ({
    x: b.position.x, y: b.position.y, radius: b.radius, color: '#ff3e6b', id: b.id
  })));

  // Verificação de resultado a cada frame (feito no loop)
}

/**
 * Adiciona uma entrada ao histórico da UI.
 */
function addHistoryEntry(result) {
  if (!UI.historyList) return;
  const li = document.createElement('li');
  const date = new Date(result.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const sinal = result.multiplier >= 1 ? '+' : '−';
  li.innerHTML = `<span class="hist__time">${date}</span>
    <span class="hist__mult">x${result.multiplier}</span>
    <span class="hist__coins ${result.multiplier >= 1 ? 'win' : 'lose'}">${sinal}${Math.abs(result.coins)} 🪙</span>`;
  UI.historyList.prepend(li);
  // Limita histórico visível
  while (UI.historyList.children.length > 12) {
    UI.historyList.removeChild(UI.historyList.lastChild);
  }
}

/**
 * Processa o resultado quando a bolinha para num compartimento.
 */
async function processResult(ball) {
  const bet = ball.userData.bet;
  const slot = _findSlotForBall(ball.position.x);
  const multiplier = slot ? slot.multiplier : 0;
  const prize = Math.floor(bet * multiplier);

  // Valida recompensa antes de creditar
  const validacao = validarRecompensa(prize, 'plinko');
  if (!validacao.valido) {
    // Reembolsa a aposta se algo estiver errado
    await addCoins(bet, { origem: 'plinko', descricao: 'Reembolso aposta inválida', jogo: 'plinko' });
    await updateSaldoUI();
    showMsg('Resultado inválido. Aposta reembolsada.');
    stopBalls();
    UI.launchBtn.disabled = false;
    UI.launchBtn.textContent = 'LANÇAR BOLINHA';
    isLaunching = false;
    return;
  }

  // Credita prêmio via carteira central (atômico)
  const credito = await addCoins(prize, {
    origem: 'plinko',
    descricao: `Prêmio Plinko x${multiplier} (${DIFICULDADES_PLINKO[currentDifficulty].label})`,
    jogo: 'plinko',
    idempotencyKey: `plinko_prize_${Date.now()}_${Math.random().toString(36).slice(2)}`
  });

  if (!credito.ok) {
    // Se falhar, reembolsa aposta
    await addCoins(bet, { origem: 'plinko', descricao: 'Reembolso falha crédito', jogo: 'plinko' });
    showMsg('Erro ao processar prêmio. Aposta reembolsada.');
  }

  await updateSaldoUI();

  // Efeitos visuais e sonoros
  if (prize > 0) {
    playPrize(multiplier);
    _spawnParticles(ball.position.x, ball.position.y, slot.color);
    showMsg(`Você ganhou ${prize} moedas (x${multiplier})!`, 3000);
  } else {
    playTone(180, 'sawtooth', 0.2, 0.12);
    showMsg('Sem prêmio nesta jogada.', 2500);
  }

  // Histórico
  addHistoryEntry({ at: Date.now(), multiplier, coins: prize - bet });

  // Finaliza
  stopBalls();
  UI.launchBtn.disabled = false;
  UI.launchBtn.textContent = 'LANÇAR BOLINHA';
  isLaunching = false;
}

/**
 * Encontra o compartimento (slot) com base na posição x da bolinha.
 */
function _findSlotForBall(x) {
  if (!renderer || renderer.slots.length === 0) return null;
  const bottom = renderer.height - 60 * renderer.scale;
  // A bolinha deve estar na região inferior para contar
  for (const slot of renderer.slots) {
    if (x >= slot.x && x <= slot.x + slot.w) {
      return slot;
    }
  }
  return null;
}

/**
 * Gera partículas de premiação.
 */
function _spawnParticles(x, y, color) {
  const count = 30;
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, color || '#ff3e6b'));
  }
}

/* ============================================================
   Loop de animação
   ============================================================ */

function loop(now) {
  if (!world || !renderer) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05); // limpa spike
  lastTime = now;

  world.step(dt);

  // Atualiza posições visuais das bolas
  const ballBodies = world.getBodies().filter(b => b.label === 'ball');
  balls = ballBodies;
  if (renderer) {
    renderer.setBalls(ballBodies.map(b => ({
      x: b.position.x,
      y: b.position.y,
      radius: b.radius,
      color: '#ff3e6b',
      id: b.id
    })));
    renderer.draw();
  }

  // Partículas
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update(dt)) particles.splice(i, 1);
  }
  _drawParticles();

  // Verifica se a bolinha parou (sleeping) e está na região inferior
  const activeBall = ballBodies.find(b => !b.sleeping && !b.isStatic);
  if (balls.length === 0 || (balls.length === 1 && balls[0].sleeping && balls[0].position.y > renderer.height - 100 * renderer.scale)) {
    // Verifica se já processamos este resultado
    if (balls.length === 1 && balls[0].sleeping && !balls[0].userData.processed) {
      balls[0].userData.processed = true;
      // Pequeno atraso para o efeito visual terminar
      setTimeout(() => processResult(balls[0]), 400);
    }
  }

  animFrame = requestAnimationFrame(loop);
}

function _drawParticles() {
  if (!renderer || !renderer.ctx) return;
  for (const p of particles) p.draw(renderer.ctx);
}

/**
 * Limpeza ao sair da área.
 */
export function destroy() {
  if (animFrame) cancelAnimationFrame(animFrame);
  if (renderer) renderer.destroy();
  world = null;
  renderer = null;
  balls = [];
  particles = [];
  isLaunching = false;
  UI.launchBtn = null;
}
