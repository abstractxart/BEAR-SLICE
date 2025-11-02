// src/scenes/FruitSliceGameScene.ts
import Phaser from "phaser";
import * as utils from "../utils";
import { gameplayConfig, scoreConfig } from "../gameConfig.json";

interface FruitType {
  key: string;
  sliceSound: string;
  juiceColor: number;
  points: number;
  rarity: number; // weighted selection
}

type SlicePt = { x: number; y: number; t: number };

export class FruitSliceGameScene extends Phaser.Scene {
  // ------- GAME STATE -------
  public lives = 3;
  public score = 0;
  public combo = 0;
  public maxCombo = 0;
  public isGameOver = false;
  public isPaused = false;

  // streaks
  public currentSliceStreak = 0;

  // timers
  private spawnEvent?: Phaser.Time.TimerEvent;
  private comboTimer?: Phaser.Time.TimerEvent;

  // ------- OBJECTS / POOLS -------
  private fruitPool!: Phaser.Physics.Arcade.Group;        // pooled Phaser.Physics.Arcade.Image
  private fruitGroup!: Phaser.GameObjects.Group;          // for easy iteration (active fruits)
  private trailGfx!: Phaser.GameObjects.Graphics;         // single ribbon trail

  private background!: Phaser.GameObjects.Image;

  // ------- INPUT / TRAIL -------
  private isSlicing = false;
  private lastPt?: SlicePt;
  private path: SlicePt[] = []; // short history for ribbon

  // ------- FEEL / JUICE -------
  private whoosh?: Phaser.Sound.BaseSound;
  private bombExplosion?: Phaser.Sound.BaseSound;
  private gameOverSnd?: Phaser.Sound.BaseSound;
  private perfectSliceSnd?: Phaser.Sound.BaseSound;
  private sliceSnds: Map<string, Phaser.Sound.BaseSound> = new Map();

  // hit windows
  private readonly sliceRadiusBase = 56;     // base hit radius
  private readonly magnetRadius = 24;        // gentle assist

  // difficulty
  private startTime = 0;
  private emaSuccess = 0.65;                 // exponential moving avg of slice success (0..1)
  private emaAlpha = 0.08;
  private spawnDelay = 850;                  // ms (will adapt)
  private minDelay = 380;
  private maxDelay = 1100;
  private spawnsSinceStart = 0;

  // tracking
  private totalFruits = 0;
  private totalSliced = 0;
  private lastSliceAt = 0;

  // types (Bearverse items in place of fruit)
  public fruitTypes: FruitType[] = [
    { key: "red_mask",        sliceSound: "slice_red_mask",        juiceColor: 0xff0000, points: 10, rarity: 100 },
    { key: "golden_crown",    sliceSound: "slice_golden_crown",    juiceColor: 0xffd700, points: 15, rarity: 80  },
    { key: "sheriff_hat",     sliceSound: "slice_sheriff_hat",     juiceColor: 0x8b4513, points: 12, rarity: 100 },
    { key: "jester_hat",      sliceSound: "slice_jester_hat",      juiceColor: 0x4169e1, points: 12, rarity: 100 },
    { key: "pearl_shell",     sliceSound: "slice_pearl_shell",     juiceColor: 0xc0c0c0, points: 14, rarity: 70  },
    { key: "red_wrench",      sliceSound: "slice_red_wrench",      juiceColor: 0xff4500, points: 11, rarity: 90  },
    { key: "golden_coin",     sliceSound: "slice_golden_coin",     juiceColor: 0xffd700, points: 30, rarity: 2   },
    { key: "carousel_ride",   sliceSound: "slice_carousel_ride",   juiceColor: 0x32cd32, points: 16, rarity: 50  },
    { key: "red_alchemist",   sliceSound: "slice_red_alchemist",   juiceColor: 0x8a2be2, points: 14, rarity: 60  },
    { key: "green_dragon",    sliceSound: "slice_green_dragon",    juiceColor: 0x228b22, points: 22, rarity: 15  },
    { key: "phoenix_emblem",  sliceSound: "slice_phoenix_emblem",  juiceColor: 0xff4500, points: 25, rarity: 5   },
    { key: "x_coin",          sliceSound: "slice_x_coin",          juiceColor: 0x000000, points: 18, rarity: 25  }
  ];

  constructor() {
    super({ key: "FruitSliceGameScene" });
  }

  // ---------------------------- LIFECYCLE ----------------------------
  create(): void {
    // init
    this.lives = gameplayConfig.lives?.value ?? 3;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.startTime = this.time.now;
    this.spawnsSinceStart = 0;
    this.totalFruits = 0;
    this.totalSliced = 0;

    // background
    this.background = this.add.image(this.scale.gameSize.width / 2, this.scale.gameSize.height / 2, "ninja_dojo_background");
    utils.initScale(this.background, { x: 0.5, y: 0.5 }, this.scale.gameSize.width, this.scale.gameSize.height);
    this.background.setScrollFactor(0);

    // trail
    this.trailGfx = this.add.graphics().setDepth(-1).setAlpha(0.95);

    // pools
    this.fruitPool = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 72,
      runChildUpdate: false
    });
    this.fruitGroup = this.add.group();

    // sounds
    const master = parseFloat(localStorage.getItem("sliceSurge_masterVolume") || "1");
    const sfxVol = parseFloat(localStorage.getItem("sliceSurge_sfxVolume") || "0.35") * master;
    const safeAdd = (k: string, v = sfxVol) => { try { return this.sound.add(k, { volume: v }); } catch { return undefined; } };
    this.bombExplosion  = safeAdd("bomb_explosion", sfxVol);
    this.gameOverSnd    = safeAdd("game_over_sound", sfxVol * 1.6);
    this.perfectSliceSnd= safeAdd("perfect_slice", sfxVol * 1.1) || safeAdd("ui_click", sfxVol * 1.1);
    this.whoosh         = safeAdd("slice_whoosh", Math.min(0.5, sfxVol));
    this.fruitTypes.forEach(ft => this.sliceSnds.set(ft.key, safeAdd(ft.sliceSound) as Phaser.Sound.BaseSound));

    // input
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isPaused) return;
      this.isSlicing = true;
      this.path.length = 0;
      this.lastPt = { x: p.x, y: p.y, t: this.time.now };
      this.path.push(this.lastPt);
      this.whoosh?.play({ rate: 1 });
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.isSlicing || this.isGameOver || this.isPaused) return;
      const now = this.time.now;
      const curr: SlicePt = { x: p.x, y: p.y, t: now };
      if (this.lastPt) {
        this.checkSegmentCutsFruits(this.lastPt, curr);
      }
      this.path.push(curr);
      this.lastPt = curr;
      // trim history ~150 ms
      const cutoff = now - 150;
      while (this.path.length && this.path[0].t < cutoff) this.path.shift();
    });
    this.input.on("pointerup", () => {
      this.isSlicing = false;
      this.lastPt = undefined;
    });

    // pause/resume on ESC
    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      if (!this.isGameOver && !this.isPaused) this.pauseGame();
    });

    // pause on blur, resume on focus
    this.game.events.on(Phaser.Core.Events.BLUR, () => { if (!this.isGameOver) this.pauseGame(); });
    this.game.events.on(Phaser.Core.Events.FOCUS, () => { if (!this.isGameOver) this.resumeGame(); });

    // UI side scene
    this.scene.launch("UIScene", { currentLevelKey: this.scene.key });
    this.events.emit("scoreUpdated", this.score);
    this.events.emit("livesUpdated", this.lives);
    this.events.emit("comboUpdated", this.combo);
    this.events.emit("streakUpdated", this.currentSliceStreak);

    // start spawning
    this.resetSpawnTimer(this.spawnDelay);
  }

  update(): void {
    if (this.isGameOver || this.isPaused) return;

    // ribbon trail draw (single Graphics, per-frame)
    this.drawRibbon();

    // cleanup & life loss
    const bottom = this.scale.gameSize.height + 60;
    const side = this.scale.gameSize.width + 60;
    this.fruitGroup.children.each((obj: Phaser.GameObjects.GameObject) => {
      const img = obj as Phaser.Physics.Arcade.Image & { isBomb?: boolean; wasSliced?: boolean };
      if (!img.active) return;

      if (img.y > bottom || img.x < -60 || img.x > side || img.y < -200) {
        const shouldLose = !img.wasSliced && !img.getData("isBomb");
        this.despawnFruit(img);
        if (shouldLose) this.loseLife();
      }
    });

    // adaptive difficulty target delay
    const minutes = (this.time.now - this.startTime) / 60000;
    const scoreLevel = Math.floor(this.score / (gameplayConfig.difficultyIncreaseInterval?.value ?? 120));
    const baseTarget = Phaser.Math.Linear(this.maxDelay, this.minDelay, Phaser.Math.Clamp((minutes * 0.5 + scoreLevel * 0.08), 0, 1));
    // success EMA pulls delay down when player is doing well
    const successPull = Phaser.Math.Linear(1, 0.7, Phaser.Math.Clamp((this.emaSuccess - 0.5) * 2, 0, 1));
    const targetDelay = Phaser.Math.Clamp(baseTarget * successPull, this.minDelay, this.maxDelay);
    // smoothly move spawnDelay toward target
    this.spawnDelay += (targetDelay - this.spawnDelay) * 0.02;
  }

  // ---------------------------- SPAWNING ----------------------------
  private resetSpawnTimer(delay: number) {
    if (this.spawnEvent) this.spawnEvent.destroy();
    this.spawnEvent = this.time.addEvent({
      delay,
      loop: true,
      callback: () => {
        if (this.isPaused || this.isGameOver) return;
        this.spawnWave();
        // refresh timer with new adaptive delay
        this.resetSpawnTimer(this.spawnDelay);
      }
    });
  }

  private spawnWave() {
    // fair-bomb rules:
    //  - first 20 spawns: no bombs
    //  - never spawn a solo bomb
    //  - at low success EMA, reduce bomb chance
    const effectiveLevel = Math.floor(this.score / (gameplayConfig.difficultyIncreaseInterval?.value ?? 120));
    const allowBombs = this.spawnsSinceStart >= 20;
    const baseBomb = gameplayConfig.minBombChance?.value ?? 0.05;
    const maxBomb = gameplayConfig.maxBombChance?.value ?? 0.22;
    let bombChance = Phaser.Math.Linear(baseBomb, maxBomb, Phaser.Math.Clamp(effectiveLevel / 6, 0, 1));
    bombChance *= Phaser.Math.Linear(0.3, 1.0, Phaser.Math.Clamp((this.emaSuccess - 0.45) * 3, 0, 1)); // help struggling players

    const multiChance = Phaser.Math.Linear(
      gameplayConfig.minMultiFruitChance?.value ?? 0.15,
      gameplayConfig.maxMultiFruitChance?.value ?? 0.7,
      Phaser.Math.Clamp(effectiveLevel / 6, 0, 1)
    );

    const isMulti = Math.random() < multiChance;
    const count = isMulti ? Phaser.Math.Between(2, Math.min(4, 1 + Math.floor(effectiveLevel / 2))) : 1;

    let bombsToSpawn = 0;
    if (allowBombs) {
      for (let i = 0; i < count; i++) if (Math.random() < bombChance) bombsToSpawn++;
      if (count === 1 && bombsToSpawn === 1) bombsToSpawn = 0; // never solo bomb
    }

    const screenW = this.scale.gameSize.width;
    for (let i = 0; i < count; i++) {
      const isBomb = bombsToSpawn > 0 && Math.random() < bombsToSpawn / (count - i);
      if (isBomb) bombsToSpawn--;
      const x = (screenW * 0.15) + (screenW * 0.7) * (count === 1 ? Math.random() : (i / (count - 1)));
      this.spawnFruitAt(x + Phaser.Math.Between(-28, 28));
    }

    this.spawnsSinceStart++;
  }

  private spawnFruitAt(x: number) {
    const screenH = this.scale.gameSize.height;
    const type = this.rollType();
    const willBeBomb = Math.random() < 0; // bombs handled in wave; keep here false
    const isGolden = !willBeBomb && Math.random() < (gameplayConfig.goldenFruitChance?.value ?? 0.012);

    const img = this.fruitPool.get(0, 0) as Phaser.Physics.Arcade.Image;
    if (!img) return; // pool exhausted
    img.setActive(true).setVisible(true);

    if (willBeBomb) {
      img.setTexture("bomb_object");
      img.setData("isBomb", true);
    } else if (isGolden) {
      img.setTexture("golden_fruit_powerup");
      img.setData("isBomb", false);
      img.setData("isGolden", true);
    } else {
      img.setTexture(type.key);
      img.setData("juice", type.juiceColor);
      img.setData("points", type.points);
      img.setData("isBomb", false);
      img.setData("isGolden", false);
    }

    const size = (willBeBomb ? 1.0 : (isGolden ? 1.35 : 1.0)) * (gameplayConfig.fruitSize?.value ?? 128);
    utils.initScale(img, { x: 0.5, y: 0.5 }, undefined, size);

    // place & velocity
    img.setPosition(x, screenH + 60);
    const base = gameplayConfig.fruitLaunchSpeed?.value ?? 620;
    const vx = Phaser.Math.Between(-120, 120);
    const vy = - (base + Phaser.Math.Between(-80, 80));
    img.setVelocity(vx, vy);
    img.setAngularVelocity(Phaser.Math.Between(-180, 180));
    img.setGravityY((gameplayConfig.fruitGravity?.value ?? 1650));

    // flags
    (img as any).wasSliced = false;

    this.fruitGroup.add(img);
    this.totalFruits++;
  }

  private rollType(): FruitType {
    const total = this.fruitTypes.reduce((a, b) => a + b.rarity, 0);
    let r = Math.random() * total;
    for (const ft of this.fruitTypes) {
      r -= ft.rarity;
      if (r <= 0) return ft;
    }
    return this.fruitTypes[0];
  }

  // ---------------------------- SLICE DETECTION ----------------------------
  private checkSegmentCutsFruits(a: SlicePt, b: SlicePt) {
    // fast swipe speed => slightly bigger radius + whoosh pitch
    const dt = Math.max(1, b.t - a.t);
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    const speed = dist / dt; // px/ms
    const speedBoost = Phaser.Math.Clamp(speed * 0.9, 0, 1.2);
    const sliceR = this.sliceRadiusBase + 18 * speedBoost;

    // ribbon magnets (assist)
    const magnet = this.magnetRadius;

    // vibrate gently on quick swipes (mobile)
    if (speed > 0.9 && "vibrate" in navigator) (navigator as any).vibrate?.(5);

    // sweep fruits
    this.fruitGroup.children.each((obj: Phaser.GameObjects.GameObject) => {
      const fruit = obj as Phaser.Physics.Arcade.Image & { wasSliced?: boolean };
      if (!fruit.active || fruit.wasSliced) return;

      const cx = fruit.x, cy = fruit.y;
      // distance from segment AB to circle center
      if (this.segmentCircle(a.x, a.y, b.x, b.y, cx, cy, sliceR + magnet)) {
        this.sliceFruit(fruit, speedBoost);
      }
    });
  }

  private segmentCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
    const abx = bx - ax, aby = by - ay;
    const acx = cx - ax, acy = cy - ay;
    const ab2 = abx * abx + aby * aby || 0.0001;
    const t = Phaser.Math.Clamp((acx * abx + acy * aby) / ab2, 0, 1);
    const px = ax + abx * t, py = ay + aby * t;
    const dx = cx - px, dy = cy - py;
    return (dx * dx + dy * dy) <= r * r;
  }

  // ---------------------------- SLICE RESOLUTION ----------------------------
  private sliceFruit(img: Phaser.Physics.Arcade.Image & { wasSliced?: boolean }, speedBoost: number) {
    if (img.getData("isBomb")) {
      this.handleBomb(img);
      return;
    }

    img.wasSliced = true;
    this.totalSliced++;
    this.currentSliceStreak++;
    this.events.emit("streakUpdated", this.currentSliceStreak);

    // quality window
    const now = this.time.now;
    const delta = now - this.lastSliceAt;
    const perfectWin = gameplayConfig.perfectSliceWindow?.value ?? 110;
    const isPerfect = delta < perfectWin;
    this.lastSliceAt = now;

    // score + combo
    if (this.comboTimer) this.comboTimer.destroy();
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    let mult = this.combo > 1 ? (scoreConfig.comboMultiplier?.value ?? 1.05) : 1;
    if (isPerfect) mult *= (scoreConfig.perfectSliceMultiplier?.value ?? 1.4);
    const base = img.getData("points") ?? 10;
    const add = Math.floor(base * mult);
    this.score += add;
    this.events.emit("scoreUpdated", this.score);
    this.events.emit("comboUpdated", this.combo);
    this.comboTimer = this.time.delayedCall(gameplayConfig.comboTimeWindow?.value ?? 900, () => {
      this.combo = 0;
      this.events.emit("comboUpdated", this.combo);
    });

    // sound
    const key = img.texture.key;
    this.sliceSnds.get(key)?.play({ rate: isPerfect ? 1.12 : 1.0 });
    if (isPerfect) this.perfectSliceSnd?.play({ rate: 1.0 + Phaser.Math.FloatBetween(0, 0.15) });

    // hitstop (micro slow-mo on perfect)
    if (isPerfect) this.hitStop(65);

    // tiny shake (safe)
    this.cameras.main.shake(90, 0.004 + 0.004 * Math.min(1, speedBoost));

    // split halves (recycled images would complicate; short-lived ok)
    this.spawnHalves(img);

    // despawn original
    this.despawnFruit(img);

    // golden bonus (no zoom; keep flow silky)
    if (img.getData("isGolden")) {
      this.score += (scoreConfig.goldenFruitPoints?.value ?? 150);
      this.events.emit("scoreUpdated", this.score);
      // temporary faster spawns for a few seconds
      const before = this.spawnDelay;
      this.spawnDelay = Math.max(this.minDelay, this.spawnDelay * 0.75);
      this.time.delayedCall(3500, () => { this.spawnDelay = before; });
    }

    // success EMA nudged up
    this.bumpEma(true);
  }

  private hitStop(ms: number) {
    // slight slow motion; return safely
    const world = this.physics.world;
    const prevTW = this.time.timeScale;
    const prevPW = world.timeScale;
    this.time.timeScale = 0.5;
    world.timeScale = 0.5;
    this.time.delayedCall(ms, () => {
      this.time.timeScale = prevTW;
      world.timeScale = prevPW;
    });
  }

  private spawnHalves(img: Phaser.Physics.Arcade.Image) {
    const key = img.texture.key;
    const left = this.add.image(img.x - 10, img.y, key).setDepth(1);
    const right = this.add.image(img.x + 10, img.y, key).setDepth(1);
    const size = img.displayHeight; // already scaled
    utils.initScale(left, { x: 0.5, y: 0.5 }, undefined, size);
    utils.initScale(right, { x: 0.5, y: 0.5 }, undefined, size);

    left.setCrop(0, 0, left.width / 2, left.height);
    right.setCrop(right.width / 2, 0, right.width / 2, right.height);

    this.tweens.add({
      targets: left, x: left.x - 90, y: left.y + 60, angle: left.angle - 30,
      alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => left.destroy()
    });
    this.tweens.add({
      targets: right, x: right.x + 90, y: right.y + 60, angle: right.angle + 30,
      alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => right.destroy()
    });
  }

  private despawnFruit(img: Phaser.Physics.Arcade.Image & { wasSliced?: boolean }) {
    img.setActive(false).setVisible(false);
    img.body?.stop();
    img.setAngularVelocity(0);
    img.removeData("points");
    img.removeData("juice");
    img.removeData("isBomb");
    img.removeData("isGolden");
    (img as any).wasSliced = false;
    this.fruitPool.killAndHide(img);
  }

  private handleBomb(bomb: Phaser.Physics.Arcade.Image) {
    // juice-y but safe flash
    this.bombExplosion?.play();
    const flash = this.add.rectangle(
      this.scale.gameSize.width / 2, this.scale.gameSize.height / 2,
      this.scale.gameSize.width, this.scale.gameSize.height,
      0xffffff, 0.8
    ).setDepth(9999);
    this.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: () => flash.destroy() });
    this.cameras.main.shake(280, 0.018);

    this.despawnFruit(bomb);
    this.gameOver();
  }

  // ---------------------------- DIFFICULTY / META ----------------------------
  private bumpEma(success: boolean) {
    const v = success ? 1 : 0;
    this.emaSuccess = this.emaSuccess * (1 - this.emaAlpha) + v * this.emaAlpha;
  }

  private loseLife() {
    this.lives--;
    this.events.emit("livesUpdated", this.lives);
    this.currentSliceStreak = 0;
    this.events.emit("streakUpdated", this.currentSliceStreak);
    this.bumpEma(false);
    if (this.lives <= 0) this.gameOver();
  }

  private gameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    // stop timers
    this.spawnEvent?.destroy();
    this.comboTimer?.destroy();

    // sounds/UI
    this.gameOverSnd?.play();

    const newRank = utils.addHighScore(this.score);
    const isHigh = utils.isHighScore(this.score);
    const highs = utils.getHighScores();

    this.scene.launch("GameOverUIScene", {
      currentLevelKey: this.scene.key,
      finalScore: this.score,
      newRank,
      isHighScore: isHigh,
      highScores: highs
    });
  }

  // ---------------------------- TRAIL RIBBON ----------------------------
  private drawRibbon() {
    this.trailGfx.clear();
    if (this.path.length < 2) return;

    // width/alpha fade from newest->oldest
    for (let i = 1; i < this.path.length; i++) {
      const p0 = this.path[i - 1], p1 = this.path[i];
      const age = (this.time.now - p1.t) / 150; // 0..1
      const a = Phaser.Math.Clamp(1 - age, 0, 1);
      const w = 10 * a + 2;
      // color hint: if near fruit, tint toward its juice
      const col = 0xffffff;
      this.trailGfx.lineStyle(w, col, a * 0.9);
      this.trailGfx.beginPath();
      this.trailGfx.moveTo(p0.x, p0.y);
      this.trailGfx.lineTo(p1.x, p1.y);
      this.trailGfx.strokePath();
    }
  }

  // ---------------------------- PAUSE/RESUME ----------------------------
  pauseGame() {
    if (this.isPaused) return;
    this.isPaused = true;
    this.sound.pauseAll();
    this.scene.launch("PauseMenuScene", { gameSceneKey: this.scene.key });
  }

  resumeGame() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.sound.resumeAll();
  }
}

export default FruitSliceGameScene;