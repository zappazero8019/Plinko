/**
 * renderer.js — Renderer Canvas 2D do Plinko (Arcade Collection Alpha)
 *
 * Desenha o tabuleiro triangular, pinos, paredes laterais, bolinhas animadas
 * (posições vindas do motor físico), compartimentos inferiores e multiplicadores.
 * Totalmente responsivo: adapta-se ao tamanho do container pai.
 *
 * Não acessa IndexedDB nem saldo. Recebe apenas dados de apresentação.
 */

export class PlinkoRenderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Estado visual
    this.balls = [];           // { x, y, radius, color, id }
    this.pins = [];            // { x, y, radius }
    this.walls = [];           // { x1, y1, x2, y2 }
    this.slots = [];           // { x, y, w, h, multiplier, color }
    this.anchor = { x: 0, y: 0 }; // ponto de lançamento

    // Dimensões lógicas (redimensionadas no resize)
    this.width = 0;
    this.height = 0;
    this.scale = 1;

    this._boundResize = this.resize.bind(this);
    window.addEventListener('resize', this._boundResize);
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement
      ? this.canvas.parentElement.getBoundingClientRect()
      : { width: 320, height: 560 };

    // Limite máximo para não quebrar em telas grandes
    const maxW = Math.min(Math.floor(rect.width), 520);
    const maxH = Math.min(Math.floor(rect.height), 700);

    this.canvas.width = maxW;
    this.canvas.height = maxH;
    this.width = maxW;
    this.height = maxH;
    this.scale = this.width / 320; // base de referência 320px de largura

    // Garante que o CSS não estique o bitmap
    this.canvas.style.width = '100%';
    this.canvas.style.height = 'auto';
    this.canvas.style.display = 'block';

    this._buildBoard();
  }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
  }

  /* ============================================================
     Construção do tabuleiro triângular
     ============================================================ */

  _buildBoard() {
    const cx = this.width / 2;
    const top = 40 * this.scale;
    const bottom = this.height - 60 * this.scale;
    const halfW = (this.width - 40 * this.scale) / 2;

    // Ponto de lançamento (topo)
    this.anchor = { x: cx, y: top };

    // Paredes laterais (segmentos)
    this.walls = [
      { x1: cx - halfW * 0.15, y1: top + 10 * this.scale, x2: cx - halfW, y2: bottom },
      { x1: cx + halfW * 0.15, y1: top + 10 * this.scale, x2: cx + halfW, y2: bottom }
    ];

    // Pinos dispostos em grade triangular
    this.pins = [];
    const pinRadius = 5 * this.scale;
    const rows = 12; // padrão; atualizado pelo jogo via setDifficulty
    const rowSpacing = (bottom - top - 40 * this.scale) / Math.max(rows - 1, 1);
    const colSpacing = (halfW * 1.6) / Math.max(rows, 1);

    for (let r = 0; r < rows; r++) {
      const y = top + 30 * this.scale + r * rowSpacing;
      const pinCount = r + 1;
      const startX = cx - (pinCount - 1) * colSpacing * 0.5;
      for (let c = 0; c < pinCount; c++) {
        this.pins.push({
          x: startX + c * colSpacing,
          y,
          radius: pinRadius
        });
      }
    }

    // Compartimentos inferiores (slots)
    this.slots = [];
    const slotCount = 9;
    const slotW = (halfW * 2) / slotCount;
    const slotH = 50 * this.scale;
    const slotY = bottom - slotH * 0.5;
    const multipliers = [0.2, 0.5, 1, 2, 5, 10, 5, 2, 1];
    const slotColors = [
      '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff',
      '#5f27cd', '#ff9ff3', '#feca57', '#ff6b6b'
    ];
    for (let i = 0; i < slotCount; i++) {
      this.slots.push({
        x: cx - halfW + i * slotW,
        y: slotY,
        w: slotW,
        h: slotH,
        multiplier: multipliers[i],
        color: slotColors[i]
      });
    }
  }

  /** Atualiza a quantidade de fileiras (dificuldade) e reconstrói pinos. */
  setDifficulty(rows) {
    // Rebuild apenas pinos (não paredes/slots/anchor)
    const cx = this.width / 2;
    const top = 40 * this.scale;
    const bottom = this.height - 60 * this.scale;
    const halfW = (this.width - 40 * this.scale) / 2;
    const pinRadius = 5 * this.scale;
    const rowSpacing = (bottom - top - 40 * this.scale) / Math.max(rows - 1, 1);
    const colSpacing = (halfW * 1.6) / Math.max(rows, 1);

    this.pins = [];
    for (let r = 0; r < rows; r++) {
      const y = top + 30 * this.scale + r * rowSpacing;
      const pinCount = r + 1;
      const startX = cx - (pinCount - 1) * colSpacing * 0.5;
      for (let c = 0; c < pinCount; c++) {
        this.pins.push({
          x: startX + c * colSpacing,
          y,
          radius: pinRadius
        });
      }
    }
  }

  /* ============================================================
     Estado de apresentação
     ============================================================ */

  setBalls(balls) {
    this.balls = balls;
  }

  /* ============================================================
     Desenho
     ============================================================ */

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  draw() {
    if (!this.ctx) return;
    this.clear();

    this._drawBackground();
    this._drawSlots();
    this._drawWalls();
    this._drawPins();
    this._drawAnchor();
    this._drawBalls();
    this._drawSlotLabels();
  }

  _drawBackground() {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#1f1f33');
    grad.addColorStop(1, '#161625');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Borda do tabuleiro
    ctx.strokeStyle = '#3a3a5c';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, this.width - 20, this.height - 20);
  }

  _drawAnchor() {
    const ctx = this.ctx;
    const { x, y } = this.anchor;
    ctx.beginPath();
    ctx.arc(x, y, 7 * this.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3e6b';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(10, 10 * this.scale)}px 'Pixel', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('LANÇAR', x, y - 14 * this.scale);
  }

  _drawPins() {
    const ctx = this.ctx;
    for (const pin of this.pins) {
      ctx.beginPath();
      ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#3a3a5c';
      ctx.fill();
      ctx.strokeStyle = '#5a5a80';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawWalls() {
    const ctx = this.ctx;
    ctx.strokeStyle = '#3a3a5c';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const w of this.walls) {
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }
  }

  _drawSlots() {
    const ctx = this.ctx;
    for (const slot of this.slots) {
      ctx.fillStyle = slot.color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = slot.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
    }
  }

  _drawSlotLabels() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    for (const slot of this.slots) {
      const fontSize = Math.max(10, 12 * this.scale);
      ctx.font = `bold ${fontSize}px 'Pixel', monospace`;
      ctx.fillStyle = slot.color;
      ctx.fillText(`x${slot.multiplier}`, slot.x + slot.w / 2, slot.y + slot.h / 2 + 4);
      ctx.fillStyle = '#e8e8f0';
    }
  }

  _drawBalls() {
    const ctx = this.ctx;
    for (const ball of this.balls) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = ball.color || '#ff3e6b';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Brilho (glow)
      ctx.shadowColor = ball.color || '#ff3e6b';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
