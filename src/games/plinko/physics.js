/**
 * physics.js — Motor físico próprio para o Plinko (Arcade Collection Alpha)
 *
 * Implementa uma simulação física real (NÃO animação simulada):
 *  - Integração semi-implícita de Euler com substepping para estabilidade
 *  - Detecção de colisão círculo-círculo (bolinha-pino, bolinha-bolinhas)
 *  - Detecção de colisão círculo-segmento (bolinha-parede lateral)
 *  - Resolução de colisão por impulso com restituição (quicamento) e fricção
 *  - Gravidade configurável
 *  - Corpos estáticos (pinos, paredes) e dinâmicos (bolinhas)
 *  - Dormência (sleeping) para corpos parados, otimizando desempenho
 *
 * Nenhuma dependência externa. Armazenado localmente no repositório.
 * Aberto para extensão: pode ser substituído por Matter.js no futuro sem
 * afetar a camada de jogo (index.js) nem a carteira central.
 */

/* ============================================================
   Vetor 2D
   ============================================================ */

const Vec = {
  create(x = 0, y = 0) { return { x, y }; },
  clone(v) { return { x: v.x, y: v.y }; },
  add(a, b, out = {}) { out.x = a.x + b.x; out.y = a.y + b.y; return out; },
  sub(a, b, out = {}) { out.x = a.x - b.x; out.y = a.y - b.y; return out; },
  mult(v, s, out = {}) { out.x = v.x * s; out.y = v.y * s; return out; },
  div(v, s, out = {}) { out.x = v.x / s; out.y = v.y / s; return out; },
  dot(a, b) { return a.x * b.x + a.y * b.y; },
  cross(a, b) { return a.x * b.y - a.y * b.x; },
  mag(v) { return Math.sqrt(v.x * v.x + v.y * v.y); },
  magSq(v) { return v.x * v.x + v.y * v.y; },
  normalise(v, out = {}) {
    const m = Vec.mag(v);
    if (m === 0) { out.x = 0; out.y = 0; return out; }
    out.x = v.x / m; out.y = v.y / m; return out;
  },
  dist(a, b) { return Vec.mag(Vec.sub(a, b)); },
  distSq(a, b) { return Vec.magSq(Vec.sub(a, b)); },
  rotate(v, angle, out = {}) {
    const c = Math.cos(angle), s = Math.sin(angle);
    out.x = v.x * c - v.y * s;
    out.y = v.x * s + v.y * c;
    return out;
  }
};

/* ============================================================
   Corpo físico
   ============================================================ */

class Body {
  constructor({
    id,
    type = 'circle',      // 'circle' | 'segment'
    x = 0, y = 0,
    vx = 0, vy = 0,
    radius = 0,
    mass = 1,
    restitution = 0.4,    // quicamento (0 = não quica, 1 = quica perfeitamente)
    friction = 0.1,
    isStatic = false,
    angle = 0,
    angularVelocity = 0,
    label = ''
  } = {}) {
    this.id = id != null ? id : Body._nextId++;
    this.type = type;
    this.position = Vec.create(x, y);
    this.velocity = Vec.create(vx, vy);
    this.radius = radius;
    this.mass = mass;
    this.invMass = isStatic ? 0 : 1 / mass;
    this.restitution = restitution;
    this.friction = friction;
    this.isStatic = isStatic;
    this.angle = angle;
    this.angularVelocity = angularVelocity;
    this.label = label;
    this.force = Vec.create(0, 0);
    this.sleeping = false;
    this.sleepTimer = 0;
    this.userData = null;
  }

  applyForce(fx, fy) {
    if (this.isStatic || this.sleeping) return;
    this.force.x += fx;
    this.force.y += fy;
  }

  applyImpulse(ix, iy) {
    if (this.isStatic || this.sleeping) return;
    this.velocity.x += ix * this.invMass;
    this.velocity.y += iy * this.invMass;
  }

  setVelocity(vx, vy) {
    this.velocity.x = vx;
    this.velocity.y = vy;
  }

  isAwake() {
    return !this.sleeping && !this.isStatic;
  }
}

Body._nextId = 0;

/* ============================================================
   Mundo físico
   ============================================================ */

class World {
  constructor({
    gravityX = 0,
    gravityY = 980,          // px/s² (para baixo)
    substeps = 8,            // passos por frame para estabilidade
    sleepThreshold = 0.02,   // velocidade abaixo da qual o corpo dorme
    sleepTime = 0.5          // segundos parado antes de dormir
  } = {}) {
    this.gravity = Vec.create(gravityX, gravityY);
    this.bodies = [];
    this.substeps = substeps;
    this.sleepThreshold = sleepThreshold;
    this.sleepTime = sleepTime;
    this.time = 0;
    this.onCollision = null; // callback(colisao) opcional para efeitos sonoros
  }

  add(body) {
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    const idx = this.bodies.indexOf(body);
    if (idx !== -1) this.bodies.splice(idx, 1);
  }

  getBodies() { return this.bodies; }

  /**
   * Avança a simulação por dt segundos.
   */
  step(dt) {
    if (dt <= 0) return;
    const subDt = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      this._integrate(subDt);
      this._detectAndResolveCollisions(subDt);
    }
    this.time += dt;
    this._updateSleeping(dt);
  }

  _integrate(dt) {
    const gx = this.gravity.x;
    const gy = this.gravity.y;
    const halfDt = dt * 0.5;
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;

      // Aplica gravidade como força
      b.force.x += b.mass * gx;
      b.force.y += b.mass * gy;

      // Semi-implicit Euler
      b.velocity.x += (b.force.x * b.invMass) * dt;
      b.velocity.y += (b.force.y * b.invMass) * dt;

      // Limpeza de forças acumuladas
      b.force.x = 0;
      b.force.y = 0;

      // Posição
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;

      // Rotação
      b.angle += b.angularVelocity * dt;

      // Amortecimento linear simples (ar)
      b.velocity.x *= 0.99;
      b.velocity.y *= 0.99;
    }
  }

  _detectAndResolveCollisions(dt) {
    const bodies = this.bodies;
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (a.isStatic && a.sleeping) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (a.isStatic && b.isStatic) continue;
        if (a.sleeping && b.sleeping) continue;

        const contact = this._collide(a, b);
        if (contact) {
          this._resolveContact(a, b, contact, dt);
          if (typeof this.onCollision === 'function') {
            this.onCollision({ bodyA: a, bodyB: b, contact });
          }
        }
      }
    }
  }

  _collide(a, b) {
    // Círculo-círculo
    if (a.type === 'circle' && b.type === 'circle') {
      return this._circleCircle(a, b);
    }
    // Círculo-segmento (parede)
    if (a.type === 'circle' && b.type === 'segment') {
      return this._circleSegment(a, b);
    }
    if (a.type === 'segment' && b.type === 'circle') {
      const contact = this._circleSegment(b, a);
      if (contact) {
        // Inverte normal pois a colisão foi calculada com b como círculo
        contact.normal.x = -contact.normal.x;
        contact.normal.y = -contact.normal.y;
        return contact;
      }
    }
    return null;
  }

  _circleCircle(a, b) {
    const d = Vec.sub(b.position, a.position);
    const distSq = Vec.magSq(d);
    const radii = a.radius + b.radius;
    if (distSq >= radii * radii || distSq === 0) return null;
    const dist = Math.sqrt(distSq);
    const normal = Vec.div(d, dist);
    const depth = radii - dist;
    const contactPoint = Vec.add(a.position, Vec.mult(normal, a.radius), {});
    return {
      normal,
      depth,
      point: contactPoint,
      bodyA: a,
      bodyB: b
    };
  }

  _circleSegment(circle, seg) {
    // Segmento definido por posição (meio) e angle + radius (meia-extensão)
    // Reconstruímos os extremos a partir do segmento: posição é o centro,
    // o segmento tem comprimento = radius * 2 (usamos radius como half-length)
    const halfLen = seg.radius; // para segmentos, radius = meio-comprimento
    const dir = Vec.create(Math.cos(seg.angle), Math.sin(seg.angle));
    const p1 = Vec.sub(seg.position, Vec.mult(dir, halfLen));
    const p2 = Vec.add(seg.position, Vec.mult(dir, halfLen));

    // Projeção do centro do círculo no segmento
    const segVec = Vec.sub(p2, p1);
    const segLenSq = Vec.magSq(segVec);
    let t = 0;
    if (segLenSq > 0) {
      t = Vec.dot(Vec.sub(circle.position, p1), segVec) / segLenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const closest = Vec.add(p1, Vec.mult(segVec, t), {});
    const d = Vec.sub(circle.position, closest);
    const distSq = Vec.magSq(d);
    if (distSq >= circle.radius * circle.radius || distSq === 0) return null;
    const dist = Math.sqrt(distSq);
    const normal = Vec.div(d, dist);
    const depth = circle.radius - dist;
    const contactPoint = Vec.add(closest, Vec.mult(normal, circle.radius), {});
    return {
      normal,
      depth,
      point: contactPoint,
      bodyA: circle,
      bodyB: seg
    };
  }

  _resolveContact(a, b, contact, dt) {
    const { normal, depth, bodyA, bodyB } = contact;
    const relVel = Vec.sub(bodyB.velocity, bodyA.velocity);
    const velAlongNormal = Vec.dot(relVel, normal);

    // Não resolve se já estão se afastando
    if (velAlongNormal > 0) return;

    const e = Math.min(bodyA.restitution, bodyB.restitution);
    const j = -(1 + e) * velAlongNormal;
    const invMassSum = bodyA.invMass + bodyB.invMass;
    const impulseMag = j / invMassSum;

    const impulse = Vec.mult(normal, impulseMag);
    if (!bodyA.isStatic) bodyA.applyImpulse(-impulse.x, -impulse.y);
    if (!bodyB.isStatic) bodyB.applyImpulse(impulse.x, impulse.y);

    // Fricção
    const tangent = Vec.sub(relVel, Vec.mult(normal, velAlongNormal));
    const tangentMag = Vec.mag(tangent);
    if (tangentMag > 1e-4) {
      const tangentNormal = Vec.div(tangent, tangentMag);
      const jt = -Vec.dot(relVel, tangentNormal);
      const mu = Math.sqrt(bodyA.friction * bodyB.friction);
      const impulseTangentMag = jt / invMassSum;
      const frictionImpulse = Vec.mult(tangentNormal, Math.min(impulseTangentMag, mu * impulseMag));
      if (!bodyA.isStatic) bodyA.applyImpulse(-frictionImpulse.x, -frictionImpulse.y);
      if (!bodyB.isStatic) bodyB.applyImpulse(frictionImpulse.x, frictionImpulse.y);
    }

    // Correção de penetração (proporcional à massa inversa) para evitar afundamento
    const percent = 0.4; // porcentagem da penetração a corrigir
    const slop = 0.01;   // tolerância para evitar jitter
    const correction = Math.max(depth - slop, 0) / invMassSum * percent;
    const correctionVec = Vec.mult(normal, correction);
    if (!bodyA.isStatic) {
      bodyA.position.x -= correctionVec.x * bodyA.invMass / invMassSum;
      bodyA.position.y -= correctionVec.y * bodyA.invMass / invMassSum;
    }
    if (!bodyB.isStatic) {
      bodyB.position.x += correctionVec.x * bodyB.invMass / invMassSum;
      bodyB.position.y += correctionVec.y * bodyB.invMass / invMassSum;
    }
  }

  _updateSleeping(dt) {
    for (const b of this.bodies) {
      if (b.isStatic) {
        b.sleeping = true;
        continue;
      }
      const speedSq = Vec.magSq(b.velocity);
      if (speedSq < this.sleepThreshold * this.sleepThreshold) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= this.sleepTime) b.sleeping = true;
      } else {
        b.sleepTimer = 0;
        b.sleeping = false;
      }
    }
  }
}

/**
 * Cria um corpo de pino (círculo estático pequeno).
 */
function createPin(world, x, y, radius = 8) {
  const body = new Body({
    type: 'circle',
    x, y,
    radius,
    mass: 1 / 0, // estático
    restitution: 0.2,
    friction: 0.4,
    isStatic: true,
    label: 'pin'
  });
  world.add(body);
  return body;
}

/**
 * Cria uma parede (segmento estático).
 * angle em radianos; length = comprimento total da parede.
 */
function createWall(world, x, y, angle, length) {
  const body = new Body({
    type: 'segment',
    x, y,
    radius: length / 2, // para segmentos, radius = meio-comprimento
    mass: 1 / 0,
    restitution: 0.3,
    friction: 0.5,
    isStatic: true,
    angle,
    label: 'wall'
  });
  world.add(body);
  return body;
}

/**
 * Cria uma bolinha (círculo dinâmico).
 */
function createBall(world, x, y, radius = 6, restitution = 0.4) {
  const body = new Body({
    type: 'circle',
    x, y,
    radius,
    mass: 1,
    restitution,
    friction: 0.1,
    isStatic: false,
    label: 'ball'
  });
  world.add(body);
  return body;
}

export { Vec, Body, World, createPin, createWall, createBall };
