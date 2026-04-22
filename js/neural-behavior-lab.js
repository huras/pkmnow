const BEHAVIOR_IDS = ['EXPLORE', 'WAR', 'DEFEND_KIDS'];
const FEATURE_COUNT = 7;
const HIDDEN_SIZE = 12;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - maxLogit));
  const sum = exps.reduce((acc, v) => acc + v, 0) || 1;
  return exps.map((v) => v / sum);
}

function argmax(arr) {
  let bestIdx = 0;
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] > arr[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

function randomMatrix(rows, cols, scale = 0.2) {
  const m = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      row.push((Math.random() * 2 - 1) * scale);
    }
    m.push(row);
  }
  return m;
}

class TinyMLPClassifier {
  constructor(inputSize, hiddenSize, outputSize) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;
    this.reset();
  }

  reset() {
    this.w1 = randomMatrix(this.hiddenSize, this.inputSize);
    this.b1 = new Array(this.hiddenSize).fill(0);
    this.w2 = randomMatrix(this.outputSize, this.hiddenSize);
    this.b2 = new Array(this.outputSize).fill(0);
  }

  forward(x) {
    const hRaw = new Array(this.hiddenSize).fill(0);
    const h = new Array(this.hiddenSize).fill(0);
    for (let i = 0; i < this.hiddenSize; i += 1) {
      let acc = this.b1[i];
      for (let j = 0; j < this.inputSize; j += 1) {
        acc += this.w1[i][j] * x[j];
      }
      hRaw[i] = acc;
      h[i] = Math.tanh(acc);
    }

    const logits = new Array(this.outputSize).fill(0);
    for (let i = 0; i < this.outputSize; i += 1) {
      let acc = this.b2[i];
      for (let j = 0; j < this.hiddenSize; j += 1) {
        acc += this.w2[i][j] * h[j];
      }
      logits[i] = acc;
    }

    const probs = softmax(logits);
    return { x, hRaw, h, logits, probs };
  }

  predict(x) {
    const out = this.forward(x);
    const best = argmax(out.probs);
    return {
      classIdx: best,
      confidence: out.probs[best],
      probs: out.probs
    };
  }

  trainBatch(samples, lr = 0.03) {
    let batchLoss = 0;
    for (const sample of samples) {
      const { x, y } = sample;
      const cache = this.forward(x);

      const dLogits = cache.probs.slice();
      dLogits[y] -= 1;

      batchLoss += -Math.log(Math.max(cache.probs[y], 1e-8));

      const dH = new Array(this.hiddenSize).fill(0);
      for (let j = 0; j < this.hiddenSize; j += 1) {
        let acc = 0;
        for (let i = 0; i < this.outputSize; i += 1) {
          acc += this.w2[i][j] * dLogits[i];
        }
        dH[j] = acc * (1 - cache.h[j] * cache.h[j]);
      }

      for (let i = 0; i < this.outputSize; i += 1) {
        for (let j = 0; j < this.hiddenSize; j += 1) {
          this.w2[i][j] -= lr * dLogits[i] * cache.h[j];
        }
        this.b2[i] -= lr * dLogits[i];
      }

      for (let j = 0; j < this.hiddenSize; j += 1) {
        for (let k = 0; k < this.inputSize; k += 1) {
          this.w1[j][k] -= lr * dH[j] * x[k];
        }
        this.b1[j] -= lr * dH[j];
      }
    }

    return batchLoss / Math.max(samples.length, 1);
  }

  evaluate(samples) {
    if (!samples.length) {
      return { loss: 0, accuracy: 0 };
    }

    let loss = 0;
    let correct = 0;
    for (const sample of samples) {
      const pred = this.forward(sample.x);
      loss += -Math.log(Math.max(pred.probs[sample.y], 1e-8));
      if (argmax(pred.probs) === sample.y) correct += 1;
    }
    return {
      loss: loss / samples.length,
      accuracy: correct / samples.length
    };
  }
}

function expertUtilityScores(features) {
  const enemy = features[0];
  const kidThreat = features[1];
  const resources = features[2];
  const cohesionNeed = features[3];
  const health = features[4];
  const morale = features[5];
  const stamina = features[6];

  const explore =
    0.65 +
    resources * 0.95 +
    morale * 0.45 +
    stamina * 0.25 -
    enemy * 0.95 -
    kidThreat * 1.1 -
    cohesionNeed * 0.25;

  const war =
    0.1 +
    enemy * 1.4 +
    morale * 0.38 +
    health * 0.52 +
    stamina * 0.25 -
    kidThreat * 0.35 -
    (1 - health) * 0.5;

  const defend =
    0.2 +
    kidThreat * 1.75 +
    enemy * 0.6 +
    cohesionNeed * 0.4 +
    health * 0.2;

  return [explore, war, defend];
}

function pickRuleBehavior(features) {
  const scores = expertUtilityScores(features);
  const idx = argmax(scores);
  return {
    behavior: BEHAVIOR_IDS[idx],
    confidence: softmax(scores)[idx],
    scores
  };
}

function createTrainingSample() {
  const enemy = Math.random();
  const kidThreat = Math.random();
  const resources = Math.random();
  const cohesionNeed = Math.random();
  const health = Math.random();
  const morale = Math.random();
  const stamina = Math.random();
  const x = [enemy, kidThreat, resources, cohesionNeed, health, morale, stamina];
  const rule = pickRuleBehavior(x);
  return { x, y: BEHAVIOR_IDS.indexOf(rule.behavior) };
}

class NeuralBehaviorLab {
  constructor() {
    this.canvas = document.getElementById('lab-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.logNode = document.getElementById('log');
    this.statsNode = document.getElementById('stats');
    this.modeNode = document.getElementById('controller-mode');
    this.forcedBehaviorNode = document.getElementById('forced-behavior');

    this.model = new TinyMLPClassifier(FEATURE_COUNT, HIDDEN_SIZE, BEHAVIOR_IDS.length);
    this.trainingSet = [];
    this.validationSet = [];
    this.modelReady = false;

    this.world = {
      enemyThreat: 0.25,
      kidsThreat: 0.2,
      resourceDensity: 0.6,
      cohesionNeed: 0.3,
      groupHealth: 0.85,
      groupMorale: 0.6,
      groupStamina: 0.75
    };

    this.agent = {
      x: 260,
      y: 250,
      vx: 0,
      vy: 0,
      behavior: 'EXPLORE',
      source: 'rules',
      confidence: 0.5
    };

    this.metrics = {
      stepCount: 0,
      avgDecisionMs: 0,
      counts: { EXPLORE: 0, WAR: 0, DEFEND_KIDS: 0 }
    };

    this.lastTs = performance.now();
    this.bindUI();
    this.log('Lab inicializado com árbitro de políticas.');
    requestAnimationFrame((ts) => this.loop(ts));
  }

  bindUI() {
    document.getElementById('event-enemy').onclick = () => {
      this.world.enemyThreat = 1;
      this.log('Evento: enemy spike.');
    };

    document.getElementById('event-kids').onclick = () => {
      this.world.kidsThreat = 1;
      this.log('Evento: kids in danger.');
    };

    document.getElementById('event-normalize').onclick = () => {
      this.world.enemyThreat = 0.2 + Math.random() * 0.2;
      this.world.kidsThreat = 0.15 + Math.random() * 0.2;
      this.world.resourceDensity = 0.5 + Math.random() * 0.4;
      this.world.cohesionNeed = 0.2 + Math.random() * 0.4;
      this.log('Ambiente normalizado.');
    };

    document.getElementById('build-dataset').onclick = () => {
      this.buildDataset(4800);
    };

    document.getElementById('train-model').onclick = () => {
      this.trainModel();
    };

    document.getElementById('eval-model').onclick = () => {
      this.evalModel();
    };
  }

  log(msg) {
    const node = document.createElement('li');
    node.textContent = msg;
    this.logNode.prepend(node);
    while (this.logNode.children.length > 20) {
      this.logNode.removeChild(this.logNode.lastChild);
    }
  }

  worldFeatures() {
    return [
      clamp01(this.world.enemyThreat),
      clamp01(this.world.kidsThreat),
      clamp01(this.world.resourceDensity),
      clamp01(this.world.cohesionNeed),
      clamp01(this.world.groupHealth),
      clamp01(this.world.groupMorale),
      clamp01(this.world.groupStamina)
    ];
  }

  decideBehavior() {
    const forced = this.forcedBehaviorNode.value;
    if (forced !== 'auto') {
      return { behavior: forced, confidence: 1, source: 'forced' };
    }

    const features = this.worldFeatures();
    const ruleDecision = pickRuleBehavior(features);
    const mode = this.modeNode.value;

    if (mode === 'rules' || !this.modelReady) {
      return {
        behavior: ruleDecision.behavior,
        confidence: ruleDecision.confidence,
        source: 'rules'
      };
    }

    const neuralPred = this.model.predict(features);
    const neuralBehavior = BEHAVIOR_IDS[neuralPred.classIdx];

    if (mode === 'neural') {
      return {
        behavior: neuralBehavior,
        confidence: neuralPred.confidence,
        source: 'neural'
      };
    }

    if (features[1] > 0.72) {
      return { behavior: 'DEFEND_KIDS', confidence: 1, source: 'hybrid-guardrail' };
    }

    if (features[0] > 0.78 && features[4] > 0.45) {
      return { behavior: 'WAR', confidence: 0.98, source: 'hybrid-guardrail' };
    }

    if (neuralPred.confidence >= 0.56) {
      return {
        behavior: neuralBehavior,
        confidence: neuralPred.confidence,
        source: 'hybrid-neural'
      };
    }

    return {
      behavior: ruleDecision.behavior,
      confidence: ruleDecision.confidence,
      source: 'hybrid-rules-fallback'
    };
  }

  applyBehavior(dt, behavior) {
    let targetX = this.agent.x;
    let targetY = this.agent.y;

    if (behavior === 'EXPLORE') {
      targetX += 45 * dt + (Math.random() - 0.5) * 50 * dt;
      targetY += (Math.random() - 0.5) * 50 * dt;
      this.world.resourceDensity = clamp01(this.world.resourceDensity + 0.12 * dt);
      this.world.groupStamina = clamp01(this.world.groupStamina - 0.04 * dt);
    } else if (behavior === 'WAR') {
      targetX += 20 * dt;
      targetY -= 55 * dt;
      this.world.enemyThreat = clamp01(this.world.enemyThreat - 0.18 * dt);
      this.world.groupHealth = clamp01(this.world.groupHealth - 0.08 * dt);
      this.world.groupMorale = clamp01(this.world.groupMorale + 0.05 * dt);
    } else {
      targetX -= 35 * dt;
      targetY += 40 * dt;
      this.world.kidsThreat = clamp01(this.world.kidsThreat - 0.22 * dt);
      this.world.cohesionNeed = clamp01(this.world.cohesionNeed - 0.08 * dt);
      this.world.groupStamina = clamp01(this.world.groupStamina - 0.05 * dt);
    }

    this.agent.vx = (targetX - this.agent.x) * 4.6;
    this.agent.vy = (targetY - this.agent.y) * 4.6;
    this.agent.x += this.agent.vx * dt;
    this.agent.y += this.agent.vy * dt;
    this.agent.x = Math.max(60, Math.min(this.canvas.width - 60, this.agent.x));
    this.agent.y = Math.max(60, Math.min(this.canvas.height - 60, this.agent.y));
  }

  evolveWorld(dt) {
    this.world.enemyThreat = clamp01(this.world.enemyThreat - 0.015 * dt + Math.random() * 0.01 * dt);
    this.world.kidsThreat = clamp01(this.world.kidsThreat - 0.013 * dt + Math.random() * 0.009 * dt);
    this.world.resourceDensity = clamp01(this.world.resourceDensity - 0.01 * dt + 0.006 * dt * Math.sin(performance.now() / 1000));
    this.world.cohesionNeed = clamp01(this.world.cohesionNeed + 0.012 * dt);
    this.world.groupMorale = clamp01(this.world.groupMorale - 0.01 * dt + this.world.resourceDensity * 0.006 * dt);
    this.world.groupHealth = clamp01(this.world.groupHealth + 0.012 * dt);
    this.world.groupStamina = clamp01(this.world.groupStamina + 0.01 * dt);
  }

  buildDataset(sampleCount) {
    const all = [];
    for (let i = 0; i < sampleCount; i += 1) {
      all.push(createTrainingSample());
    }

    for (let i = all.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }

    const split = Math.floor(all.length * 0.8);
    this.trainingSet = all.slice(0, split);
    this.validationSet = all.slice(split);
    this.log(`Dataset pronto: train=${this.trainingSet.length}, val=${this.validationSet.length}.`);
  }

  trainModel() {
    if (!this.trainingSet.length) {
      this.log('Dataset vazio. Clique em Build Dataset primeiro.');
      return;
    }

    this.model.reset();
    const epochs = 45;
    const batchSize = 64;
    const lr = 0.028;

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      for (let i = this.trainingSet.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.trainingSet[i], this.trainingSet[j]] = [this.trainingSet[j], this.trainingSet[i]];
      }

      let epochLoss = 0;
      for (let start = 0; start < this.trainingSet.length; start += batchSize) {
        const batch = this.trainingSet.slice(start, start + batchSize);
        epochLoss += this.model.trainBatch(batch, lr);
      }

      if ((epoch + 1) % 15 === 0 || epoch === epochs - 1) {
        const trainEval = this.model.evaluate(this.trainingSet.slice(0, 800));
        const valEval = this.model.evaluate(this.validationSet);
        this.log(
          `Epoch ${epoch + 1}/${epochs} | loss=${epochLoss.toFixed(3)} | trainAcc=${(trainEval.accuracy * 100).toFixed(1)}% | valAcc=${(valEval.accuracy * 100).toFixed(1)}%`
        );
      }
    }

    this.modelReady = true;
    this.log('Neural policy treinada. Modo Neural/Hybrid disponível.');
  }

  evalModel() {
    if (!this.modelReady) {
      this.log('Modelo ainda não treinado.');
      return;
    }
    const evalMetrics = this.model.evaluate(this.validationSet);
    this.log(
      `Evaluate -> valLoss=${evalMetrics.loss.toFixed(4)} | valAcc=${(evalMetrics.accuracy * 100).toFixed(2)}%`
    );
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#111734';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const tilesX = 19;
    const tilesY = 11;
    const tw = this.canvas.width / tilesX;
    const th = this.canvas.height / tilesY;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x <= tilesX; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * tw, 0);
      ctx.lineTo(x * tw, this.canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= tilesY; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * th);
      ctx.lineTo(this.canvas.width, y * th);
      ctx.stroke();
    }

    const enemyRadius = 35 + this.world.enemyThreat * 85;
    ctx.fillStyle = 'rgba(255, 70, 70, 0.25)';
    ctx.beginPath();
    ctx.arc(560, 150, enemyRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7f7f';
    ctx.fillText('Enemy pressure', 508, 150 - enemyRadius - 8);

    const kidsRadius = 30 + this.world.kidsThreat * 90;
    ctx.fillStyle = 'rgba(255, 214, 92, 0.22)';
    ctx.beginPath();
    ctx.arc(170, 350, kidsRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe197';
    ctx.fillText('Kids risk zone', 128, 350 - kidsRadius - 8);

    const resourceRadius = 35 + this.world.resourceDensity * 80;
    ctx.fillStyle = 'rgba(117, 255, 153, 0.2)';
    ctx.beginPath();
    ctx.arc(390, 250, resourceRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#87ffaa';
    ctx.fillText('Resource pocket', 346, 250 - resourceRadius - 8);

    ctx.fillStyle = '#f4f8ff';
    ctx.beginPath();
    ctx.arc(this.agent.x, this.agent.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1f32';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#d6defa';
    ctx.font = '12px Consolas, monospace';
    ctx.fillText(`Behavior: ${this.agent.behavior}`, this.agent.x - 48, this.agent.y - 24);
    ctx.fillText(`Source: ${this.agent.source}`, this.agent.x - 48, this.agent.y - 38);
  }

  updateStats() {
    this.statsNode.textContent =
      `mode=${this.modeNode.value} | forced=${this.forcedBehaviorNode.value}\n` +
      `modelReady=${this.modelReady} | steps=${this.metrics.stepCount}\n` +
      `decisionAvgMs=${this.metrics.avgDecisionMs.toFixed(3)}\n` +
      `enemy=${this.world.enemyThreat.toFixed(2)} kidsThreat=${this.world.kidsThreat.toFixed(2)} resources=${this.world.resourceDensity.toFixed(2)}\n` +
      `health=${this.world.groupHealth.toFixed(2)} morale=${this.world.groupMorale.toFixed(2)} stamina=${this.world.groupStamina.toFixed(2)}\n` +
      `countExplore=${this.metrics.counts.EXPLORE} countWar=${this.metrics.counts.WAR} countDefend=${this.metrics.counts.DEFEND_KIDS}`;
  }

  loop(ts) {
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    const start = performance.now();
    const decision = this.decideBehavior();
    const decisionCost = performance.now() - start;

    this.metrics.stepCount += 1;
    this.metrics.avgDecisionMs = this.metrics.avgDecisionMs * 0.96 + decisionCost * 0.04;

    this.agent.behavior = decision.behavior;
    this.agent.source = decision.source;
    this.agent.confidence = decision.confidence;
    this.metrics.counts[decision.behavior] += 1;

    this.applyBehavior(dt, decision.behavior);
    this.evolveWorld(dt);
    this.draw();
    this.updateStats();

    requestAnimationFrame((nextTs) => this.loop(nextTs));
  }
}

window.neuralBehaviorLab = new NeuralBehaviorLab();
