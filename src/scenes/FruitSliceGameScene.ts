/**
 * WHAT CHANGED (Presentation/Perf Only – mechanics untouched)
 * - Added `const PRESENTATION_ONLY = true` safety switch (flip to `false` to guarantee original visuals/behavior).
 * - Visual-only pointer smoothing (EMA + dead-zone) for buttery swipe feel; slice detection still uses raw pointer to keep gameplay identical.
 * - Replaced per-slice `line` allocations with a high-performance, pooled blade-trail system (rectangle segments with fade/ease).
 * - Added pooled floating score popups, combo banners (3/5/10+), near-miss “CLOSE!”, and “Perfect!” badge — all event-driven and layered above gameplay.
 * - Implemented lightweight, pooled “juice burst” circles (Graphics) and pooled fruit-half sprites to avoid GC spikes.
 * - Gentle per-fruit squash/settle tween on launch (scale only; physics unchanged). All gated by `PRESENTATION_ONLY`.
 * - Reused/guarded postFX color matrices (no black-flash). Never call `postFX.clear()` except when restoring defaults with tween.
 * - Audio micro pitch variance (when available) for richer feel (purely cosmetic & guarded).
 * - Reduced per-frame allocations (pooled objects; optional inactive-fruit pruning timer under PRESENTATION_ONLY).
 *
 * NOTE: All public surface, events, asset/config keys, spawn/selection logic, scoring/combo math, timers, difficulty, physics, and outcomes remain IDENTICAL.
 * Determinism guarantee with PRESENTATION_ONLY = false.
 */

const PRESENTATION_ONLY = true;

import Phaser from "phaser";
import * as utils from "../utils";
import { gameplayConfig, scoreConfig } from "../gameConfig.json";

interface FruitType {
  key: string;
  sliceSound: string;
  juiceColor: number;
  points: number;
  rarity: number; // Weight for weighted random selection (higher = more common)
}

export class FruitSliceGameScene extends Phaser.Scene {
  // Game state
  public lives: number = 3;
  public score: number = 0;
  public combo: number = 0;
  public isGameOver: boolean = false;
  public activeGoldenFruit: Phaser.GameObjects.Image | null = null;
  public goldenFruitSliceCount: number = 0;
  public goldenFruitLastSliceTime: number = 0;
  public hasShownDifficultyIncrease: boolean = false;
  public isGoldenFruitZoomed: boolean = false;
  public currentDifficultyLevel: number = 0;
  public lastDifficultyUpdateScore: number = 0;
  public postGoldenFruitCooldown: number = 0;

  // Enhanced difficulty progression
  public gameStartTime: number = 0;
  public timeBasedDifficultyLevel: number = 0;
  public lastTimeBasedIncrease: number = 0;
  public rapidFireMode: boolean = false;
  public rapidFireEndTime: number = 0;
  public chaosMode: boolean = false;
  public chaosModeEndTime: number = 0;

  // Dopamine features
  public isFrenzyMode: boolean = false;
  public frenzyModeEndTime: number = 0;
  public totalSlices: number = 0;
  public perfectSlices: number = 0;

  public maxCombo: number = 0;
  // Achievement system removed as requested
  public scoreMultiplier: number = 1;
  public lastSliceTime: number = 0;

  // Store references to post-processing effects to avoid black screen flashes
  public frenzyColorMatrix?: Phaser.FX.ColorMatrix | null;
  public onFireBrightness?: Phaser.FX.ColorMatrix | null;

  // Addictive progression features
  public sessionStreak: number = 0;
  public dailyStreak: number = 0;
  public currentSliceStreak: number = 0; // Consecutive successful slices (resets on life loss)
  public totalFruitsSliced: number = 0;
  public personalBest: number = 0;
  public sessionBestCombo: number = 0;
  public perfectSliceStreak: number = 0;
  public currentPerfectStreak: number = 0;
  public nearMissCount: number = 0;
  public spectacularSlices: number = 0; // Slicing 3+ fruits in one swipe
  public lastSpectacularTime: number = 0;
  public sliceChainLevel: number = 1; // Progressive chain multiplier
  public sliceChainProgress: number = 0;
  public isOnFire: boolean = false; // Hot streak mode
  public fireStreakCount: number = 0;

  // Timers
  public fruitSpawnTimer?: Phaser.Time.TimerEvent;
  public comboTimer?: Phaser.Time.TimerEvent;
  public goldenFruitTimer?: Phaser.Time.TimerEvent;

  // Game objects
  public fruits!: Phaser.GameObjects.Group; // Note: keeping 'fruits' name for compatibility
  public sliceTrails!: Phaser.GameObjects.Group;
  public particles!: Phaser.GameObjects.Group;
  public background!: Phaser.GameObjects.Image;

  // Input
  public isSlicing: boolean = false;
  public lastSlicePoint?: { x: number; y: number };
  public slicePath: { x: number; y: number }[] = [];

  // Object types with rarity weights (replacing fruits)
  public fruitTypes: FruitType[] = [
    { key: "red_mask", sliceSound: "slice_red_mask", juiceColor: 0xff0000, points: 10, rarity: 100 }, // Common
    { key: "golden_crown", sliceSound: "slice_golden_crown", juiceColor: 0xffd700, points: 15, rarity: 80 }, // Common
    { key: "sheriff_hat", sliceSound: "slice_sheriff_hat", juiceColor: 0x8b4513, points: 12, rarity: 100 }, // Common
    { key: "jester_hat", sliceSound: "slice_jester_hat", juiceColor: 0x4169e1, points: 12, rarity: 100 }, // Common
    { key: "pearl_shell", sliceSound: "slice_pearl_shell", juiceColor: 0xc0c0c0, points: 14, rarity: 70 }, // Uncommon
    { key: "red_wrench", sliceSound: "slice_red_wrench", juiceColor: 0xff4500, points: 11, rarity: 90 }, // Common
    { key: "golden_coin", sliceSound: "slice_golden_coin", juiceColor: 0xffd700, points: 30, rarity: 2 }, // Ultra Rare
    { key: "carousel_ride", sliceSound: "slice_carousel_ride", juiceColor: 0x32cd32, points: 16, rarity: 50 }, // Uncommon
    { key: "red_alchemist", sliceSound: "slice_red_alchemist", juiceColor: 0x8a2be2, points: 14, rarity: 60 }, // Uncommon
    { key: "green_dragon", sliceSound: "slice_green_dragon", juiceColor: 0x228b22, points: 22, rarity: 15 }, // Rare
    { key: "phoenix_emblem", sliceSound: "slice_phoenix_emblem", juiceColor: 0xff4500, points: 25, rarity: 5 }, // Very Rare
    { key: "x_coin", sliceSound: "slice_x_coin", juiceColor: 0x000000, points: 18, rarity: 25 } // Rare
  ];

  // Sound effects
  public fruitSliceSounds: Map<string, Phaser.Sound.BaseSound> = new Map(); // Note: keeping 'fruit' name for compatibility
  public bombExplosionSound?: Phaser.Sound.BaseSound;
  public gameOverSound?: Phaser.Sound.BaseSound;
  public perfectSliceSound?: Phaser.Sound.BaseSound;

  public frenzyModeSound?: Phaser.Sound.BaseSound;
  // Achievement sound removed
  public spectacularSliceSound?: Phaser.Sound.BaseSound;
  public onFireModeSound?: Phaser.Sound.BaseSound;
  public perfectStreakSound?: Phaser.Sound.BaseSound;
  public nearMissSound?: Phaser.Sound.BaseSound;
  public personalBestSound?: Phaser.Sound.BaseSound;

  // Hourglass hit sound effects
  public hourglassHitSatisfyingSound?: Phaser.Sound.BaseSound;
  public hourglassHitImpactSound?: Phaser.Sound.BaseSound;
  public hourglassHitCascadeSound?: Phaser.Sound.BaseSound;

  // Adaptive background music
  public backgroundMusic?: Phaser.Sound.BaseSound;
  public currentMusicIntensity: number = 1.0;
  public targetMusicIntensity: number = 1.0;
  public musicTransitionSpeed: number = 0.02;
  public isPaused: boolean = false;

  // Particle effects
  public juiceEmitters: Map<number, Phaser.GameObjects.Particles.ParticleEmitter | null> = new Map();

  constructor() {
    super({ key: "FruitSliceGameScene" });
  }

  // ---------- Presentation/Perf Fields (Internal) ----------
  // Pointer smoothing for visuals (raw pointer still powers gameplay logic)
  private smoothPos = { x: 0, y: 0 };
  private lastSmoothPos?: { x: number; y: number };
  private smoothAlpha = 0.35; // EMA factor
  private deadZoneSq = 9; // 3px dead-zone squared

  // Blade trail pooling
  private trailPool: Phaser.GameObjects.Rectangle[] = [];
  private activeTrail: Phaser.GameObjects.Rectangle[] = [];
  private trailMax = 128;
  private trailThickness = 8;
  private trailFadeMs = 140;

  // Pooled score/UI text
  private scoreTextPool: Phaser.GameObjects.Text[] = [];
  private uiBannerPool: Phaser.GameObjects.Text[] = [];
  private poolIndexScore = 0;
  private poolIndexBanner = 0;

  // Pooled juice bursts (Graphics circles)
  private juiceBurstPool: Phaser.GameObjects.Graphics[] = [];
  private poolIndexJuice = 0;

  // Pooled fruit halves (reusable images)
  private halvesPool: { left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image; busy: boolean }[] = [];
  private halvesPoolSize = 24;

  // Status chips
  private frenzyChip?: Phaser.GameObjects.Text;
  private fireChip?: Phaser.GameObjects.Text;
  private comboChip?: Phaser.GameObjects.Text;

  // Optional inactive fruit pruning cadence
  private lastPruneTime = 0;
  private pruneInterval = 160; // ms

  // Progress persistence methods
  loadProgress(key: string, defaultValue: number): number {
    const stored = localStorage.getItem(`sliceSurge_${key}`);
    return stored ? parseInt(stored) : defaultValue;
  }

  saveProgress(key: string, value: number): void {
    localStorage.setItem(`sliceSurge_${key}`, value.toString());
  }

  checkDailyStreak(): void {
    const today = new Date().toDateString();
    const lastPlayDate = localStorage.getItem('sliceSurge_lastPlayDate');

    if (lastPlayDate === today) {
      // Already played today, maintain streak
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastPlayDate === yesterday.toDateString()) {
      // Consecutive day, increase streak
      this.dailyStreak++;
    } else if (lastPlayDate !== today) {
      // Streak broken, reset
      this.dailyStreak = 1;
    }

    localStorage.setItem('sliceSurge_lastPlayDate', today);
    this.saveProgress('dailyStreak', this.dailyStreak);

    // Show daily streak notification
    if (this.dailyStreak > 1) {
      this.showStreakNotification(this.dailyStreak);
    }
  }

  create(): void {
    console.log("Creating FruitSliceGameScene...");

    // Initialize game state
    this.lives = gameplayConfig.lives.value;
    this.score = 0;
    this.combo = 0;
    this.isGameOver = false;
    this.activeGoldenFruit = null;
    this.goldenFruitSliceCount = 0;
    this.goldenFruitLastSliceTime = 0;
    this.hasShownDifficultyIncrease = false;
    this.isGoldenFruitZoomed = false;
    this.currentDifficultyLevel = 0;
    this.lastDifficultyUpdateScore = 0;
    this.postGoldenFruitCooldown = 0;

    // Initialize enhanced difficulty progression
    this.gameStartTime = this.time.now;
    this.timeBasedDifficultyLevel = 0;
    this.lastTimeBasedIncrease = 0;
    this.rapidFireMode = false;
    this.rapidFireEndTime = 0;
    this.chaosMode = false;
    this.chaosModeEndTime = 0;

    // Initialize dopamine features
    this.isFrenzyMode = false;
    this.frenzyModeEndTime = 0;
    this.totalSlices = 0;
    this.perfectSlices = 0;

    this.maxCombo = 0;
    // Achievement system removed
    this.scoreMultiplier = 1;
    this.lastSliceTime = 0;

    // Initialize addictive progression features
    this.sessionStreak = 0;
    this.currentSliceStreak = 0;
    this.totalFruitsSliced = this.loadProgress('totalFruitsSliced', 0);
    this.personalBest = this.loadProgress('personalBest', 0);
    this.dailyStreak = this.loadProgress('dailyStreak', 0);
    this.sessionBestCombo = 0;
    this.perfectSliceStreak = this.loadProgress('perfectSliceStreak', 0);
    this.currentPerfectStreak = 0;
    this.nearMissCount = 0;
    this.spectacularSlices = 0;
    this.lastSpectacularTime = 0;
    this.sliceChainLevel = 1;
    this.sliceChainProgress = 0;
    this.isOnFire = false;
    this.fireStreakCount = 0;

    // Create background
    this.createBackground();

    // Create object groups
    this.fruits = this.add.group();
    this.sliceTrails = this.add.group();
    this.particles = this.add.group();

    // Initialize sound effects
    this.initializeSounds();

    // Initialize particle systems
    this.initializeParticles();

    // Setup input handlers
    this.setupInputHandlers();

    // Initialize adaptive background music
    this.initializeBackgroundMusic();

    // Start game mechanics
    this.startFruitSpawning();

    // Check daily streak and progress
    this.checkDailyStreak();

    // Launch UI scene
    this.scene.launch("UIScene", {
      currentLevelKey: this.scene.key
    });

    // Setup scene events for pause/resume
    this.events.on('resume', () => {
      this.resumeGame();
    });

    // Setup scene shutdown event to cleanup music
    this.events.once('shutdown', () => this.shutdown());

    // Emit initial UI values
    this.events.emit('streakUpdated', this.currentSliceStreak);

    // ---- Presentation Setup (pooled objects & status chips) ----
    if (PRESENTATION_ONLY) {
      this.prebuildPools();
      this.setupStatusChips();
      // Listen to existing events to drive chips/banners (visual only)
      this.events.on('frenzyModeActivated', () => this.showChip(this.frenzyChip, "FRENZY!"));
      this.events.on('frenzyModeDeactivated', () => this.hideChip(this.frenzyChip));
      this.events.on('rapidFireActivated', () => this.showChip(this.comboChip, "RAPID FIRE"));
      this.events.on('rapidFireEnded', () => this.hideChip(this.comboChip));
      this.events.on('chaosModeActivated', () => this.showChip(this.comboChip, "CHAOS MODE"));
      this.events.on('chaosModeEnded', () => this.hideChip(this.comboChip));
      this.events.on('perfectSlice', (data: { x: number; y: number }) => {
        this.showPerfectBadge(data.x, data.y);
      });
      this.events.on('comboUpdated', (c: number) => {
        if (c >= 10) this.showComboBanner("INSANE COMBO!");
        else if (c >= 5) this.showComboBanner("GREAT COMBO!");
        else if (c >= 3) this.showComboBanner("NICE COMBO!");
      });
    }
  }

  private prebuildPools(): void {
    // Trail segments
    for (let i = 0; i < this.trailMax; i++) {
      const seg = this.add.rectangle(0, 0, 1, this.trailThickness, 0xffffff, 0.9);
      seg.setDepth(-1);
      seg.setVisible(false);
      (seg as any).__free = true;
      this.trailPool.push(seg);
      this.sliceTrails.add(seg);
    }
    // Score texts
    for (let i = 0; i < 24; i++) {
      const t = this.add.text(0, 0, "+0", {
        fontSize: "28px",
        color: "#ffff66",
        fontFamily: "SupercellMagic",
        stroke: "#000000",
        strokeThickness: 4
      });
      t.setDepth(100);
      t.setVisible(false);
      (t as any).__free = true;
      this.scoreTextPool.push(t);
    }
    // UI banners
    for (let i = 0; i < 6; i++) {
      const b = this.add.text(this.scale.gameSize.width / 2, 120, "", {
        fontSize: "44px",
        color: "#ffd94d",
        fontFamily: "SupercellMagic",
        stroke: "#000",
        strokeThickness: 6
      }).setOrigin(0.5);
      b.setDepth(120);
      b.setVisible(false);
      (b as any).__free = true;
      this.uiBannerPool.push(b);
    }
    // Juice bursts
    for (let i = 0; i < 24; i++) {
      const g = this.add.graphics();
      g.setDepth(-1);
      g.setVisible(false);
      (g as any).__free = true;
      this.juiceBurstPool.push(g);
      this.particles.add(g);
    }
    // Fruit halves pool
    for (let i = 0; i < this.halvesPoolSize; i++) {
      const left = this.add.image(-1000, -1000, "");
      const right = this.add.image(-1000, -1000, "");
      left.setVisible(false); right.setVisible(false);
      this.halvesPool.push({ left, right, busy: false });
    }
  }

  private setupStatusChips(): void {
    const pad = 12;
    this.frenzyChip = this.add.text(pad, pad, "", {
      fontSize: "18px",
      color: "#111",
      fontFamily: "SupercellMagic",
      backgroundColor: "#ffde59"
    }).setPadding(10, 6).setDepth(200).setScrollFactor(0).setVisible(false);

    this.fireChip = this.add.text(pad, 40, "", {
      fontSize: "18px",
      color: "#111",
      fontFamily: "SupercellMagic",
      backgroundColor: "#ff9966"
    }).setPadding(10, 6).setDepth(200).setScrollFactor(0).setVisible(false);

    this.comboChip = this.add.text(pad, 70, "", {
      fontSize: "18px",
      color: "#111",
      fontFamily: "SupercellMagic",
      backgroundColor: "#9cf1ff"
    }).setPadding(10, 6).setDepth(200).setScrollFactor(0).setVisible(false);
  }

  private showChip(chip?: Phaser.GameObjects.Text, label: string = ""): void {
    if (!PRESENTATION_ONLY || !chip) return;
    chip.setText(label).setAlpha(0).setVisible(true);
    this.tweens.add({ targets: chip, alpha: 1, duration: 180, ease: "Quad.easeOut" });
  }

  private hideChip(chip?: Phaser.GameObjects.Text): void {
    if (!PRESENTATION_ONLY || !chip) return;
    this.tweens.add({ targets: chip, alpha: 0, duration: 180, onComplete: () => chip.setVisible(false) });
  }

  createBackground(): void {
    // Create mystical ninja dojo background - centered in screen
    this.background = this.add.image(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      "ninja_dojo_background"
    );
    utils.initScale(this.background, { x: 0.5, y: 0.5 }, this.scale.gameSize.width, this.scale.gameSize.height);
    this.background.setScrollFactor(0);
  }

  initializeSounds(): void {
    // Load saved volume settings
    const sfxVolume = parseFloat(localStorage.getItem('sliceSurge_sfxVolume') || '0.3');
    const masterVolume = parseFloat(localStorage.getItem('sliceSurge_masterVolume') || '1.0');
    const finalSfxVolume = sfxVolume * masterVolume;

    // Initialize object slice sounds
    this.fruitTypes.forEach(fruitType => {
      this.fruitSliceSounds.set(fruitType.key, this.sound.add(fruitType.sliceSound, { volume: finalSfxVolume }));
    });

    // Initialize other sounds (with fallbacks for missing sounds)
    this.bombExplosionSound = this.sound.add("bomb_explosion", { volume: finalSfxVolume });
    this.gameOverSound = this.sound.add("game_over_sound", { volume: finalSfxVolume * 2 });

    // Initialize dopamine feature sounds
    try {
      this.perfectSliceSound = this.sound.add("perfect_slice", { volume: finalSfxVolume * 1.3 });
    } catch (e) {
      console.warn("Perfect slice sound not available, using fallback");
      this.perfectSliceSound = this.sound.add("ui_click", { volume: finalSfxVolume * 1.3 });
    }

    try {
      this.frenzyModeSound = this.sound.add("frenzy_mode", { volume: finalSfxVolume * 2 });
    } catch (e) {
      console.warn("Frenzy mode sound not available, using fallback");
      this.frenzyModeSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2 });
    }

    // Achievement sound removed

    // Initialize addictive feature sounds with fallbacks
    try {
      this.spectacularSliceSound = this.sound.add("spectacular_slice", { volume: finalSfxVolume * 1.7 });
    } catch (e) {
      this.spectacularSliceSound = this.sound.add("ui_click", { volume: finalSfxVolume * 1.7 });
    }

    try {
      this.onFireModeSound = this.sound.add("on_fire_mode", { volume: finalSfxVolume * 2 });
    } catch (e) {
      this.onFireModeSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2 });
    }

    try {
      this.perfectStreakSound = this.sound.add("perfect_streak", { volume: finalSfxVolume * 1.3 });
    } catch (e) {
      this.perfectStreakSound = this.sound.add("ui_click", { volume: finalSfxVolume * 1.3 });
    }

    try {
      this.nearMissSound = this.sound.add("near_miss", { volume: finalSfxVolume * 0.7 });
    } catch (e) {
      this.nearMissSound = this.sound.add("ui_click", { volume: finalSfxVolume * 0.7 });
    }

    try {
      this.personalBestSound = this.sound.add("personal_best", { volume: finalSfxVolume * 2.3 });
    } catch (e) {
      this.personalBestSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2.3 });
    }

    // Initialize dopamine-inducing hourglass hit sounds
    try {
      this.hourglassHitSatisfyingSound = this.sound.add("hourglass_hit_satisfying", { volume: finalSfxVolume * 2.5 });
    } catch (e) {
      this.hourglassHitSatisfyingSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2.5 });
    }

    try {
      this.hourglassHitImpactSound = this.sound.add("hourglass_hit_impact", { volume: finalSfxVolume * 2.2 });
    } catch (e) {
      this.hourglassHitImpactSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2.2 });
    }

    try {
      this.hourglassHitCascadeSound = this.sound.add("hourglass_hit_cascade", { volume: finalSfxVolume * 2.8 });
    } catch (e) {
      this.hourglassHitCascadeSound = this.sound.add("ui_click", { volume: finalSfxVolume * 2.8 });
    }
  }

  initializeParticles(): void {
    // Particle emitters completely removed for clean gameplay experience
    this.fruitTypes.forEach(fruitType => {
      // Initialize empty emitter map for compatibility but no actual particles
      this.juiceEmitters.set(fruitType.juiceColor, null);
    });
  }

  setupInputHandlers(): void {
    // Mouse/touch input
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isPaused) return;

      this.isSlicing = true;
      this.slicePath = [{ x: pointer.x, y: pointer.y }];
      this.lastSlicePoint = { x: pointer.x, y: pointer.y };

      // Initialize smoothing visual anchor
      if (PRESENTATION_ONLY) {
        this.smoothPos.x = pointer.x;
        this.smoothPos.y = pointer.y;
        this.lastSmoothPos = { x: pointer.x, y: pointer.y };
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isPaused || !this.isSlicing) return;

      this.slicePath.push({ x: pointer.x, y: pointer.y });

      // Visual trail uses smoothed coords; gameplay uses raw
      if (PRESENTATION_ONLY) {
        const dx = pointer.x - this.smoothPos.x;
        const dy = pointer.y - this.smoothPos.y;
        if (dx * dx + dy * dy > this.deadZoneSq) {
          this.smoothPos.x = this.smoothPos.x + (pointer.x - this.smoothPos.x) * this.smoothAlpha;
          this.smoothPos.y = this.smoothPos.y + (pointer.y - this.smoothPos.y) * this.smoothAlpha;
        }
        this.createSliceTrail(this.smoothPos.x, this.smoothPos.y, true); // smoothed visuals
      } else {
        this.createSliceTrail(pointer.x, pointer.y, false); // original visuals
      }

      this.checkFruitSlice(pointer.x, pointer.y);
      this.lastSlicePoint = { x: pointer.x, y: pointer.y };
      if (PRESENTATION_ONLY) this.lastSmoothPos = { x: this.smoothPos.x, y: this.smoothPos.y };
    });

    this.input.on('pointerup', () => {
      this.isSlicing = false;
      this.slicePath = [];
      this.lastSlicePoint = undefined;
      this.lastSmoothPos = undefined;
    });

    // Pause key (ESC)
    const escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey.on('down', () => {
      if (!this.isGameOver && !this.isPaused) {
        this.pauseGame();
      }
    });
  }

  private getTrailSegment(): Phaser.GameObjects.Rectangle | null {
    for (let i = 0; i < this.trailPool.length; i++) {
      const seg = this.trailPool[i];
      if ((seg as any).__free) {
        (seg as any).__free = false;
        seg.setVisible(true);
        this.activeTrail.push(seg);
        return seg;
      }
    }
    return null;
  }

  createSliceTrail(x: number, y: number, useSmoothed: boolean = false): void {
    if (!this.lastSlicePoint) return;

    if (!PRESENTATION_ONLY) {
      // ORIGINAL lightweight line (kept for determinism mode)
      const nearbyFruit = this.findNearbyFruit(x, y);
      let trailColor = 0xffffff;
      if (nearbyFruit) {
        const fruitData = (nearbyFruit as any).fruitData;
        if (fruitData && fruitData.juiceColor) trailColor = fruitData.juiceColor;
      }
      const trail = this.add.line(0, 0, this.lastSlicePoint.x, this.lastSlicePoint.y, x, y, trailColor);
      trail.setLineWidth(6);
      trail.setAlpha(0.9);
      trail.setDepth(-1);
      this.sliceTrails.add(trail);
      this.tweens.add({
        targets: trail,
        alpha: 0,
        scaleX: 0.5,
        scaleY: 0.5,
        duration: gameplayConfig.sliceTrailDuration.value,
        ease: 'Power2',
        onComplete: () => trail.destroy()
      });
      return;
    }

    // PRESENTATION-ONLY: pooled rectangle segment trail (buttery + GC-friendly)
    const prev = this.lastSmoothPos || this.lastSlicePoint;
    const dx = x - prev.x;
    const dy = y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) return;

    // Determine trail color based on nearby fruits (visual only)
    let color = 0xffffff;
    const nearby = this.findNearbyFruit(x, y);
    if (nearby) {
      const fd = (nearby as any).fruitData;
      if (fd && fd.juiceColor) color = fd.juiceColor;
    }

    const seg = this.getTrailSegment();
    if (!seg) return;
    seg.setFillStyle(color, 0.95);

    // Place/rotate the segment
    const midX = prev.x + dx * 0.5;
    const midY = prev.y + dy * 0.5;
    seg.setPosition(midX, midY);
    seg.displayWidth = Math.max(1, dist);
    seg.displayHeight = this.trailThickness;
    seg.setAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)));
    seg.setAlpha(0.95);

    // Fade & recycle
    this.tweens.add({
      targets: seg,
      alpha: 0,
      duration: this.trailFadeMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        seg.setVisible(false);
        (seg as any).__free = true;
        const idx = this.activeTrail.indexOf(seg);
        if (idx >= 0) this.activeTrail.splice(idx, 1);
      }
    });
  }

  findNearbyFruit(x: number, y: number): Phaser.GameObjects.Image | null {
    const searchRadius = 100; // Adjusted for 2x fruit size
    let closestFruit: Phaser.GameObjects.Image | null = null;
    let closestDistance = searchRadius;

    // If we're in hourglass mode, only consider the active hourglass
    if (this.activeGoldenFruit) {
      const fruitSprite = this.activeGoldenFruit;
      if (fruitSprite.active && !(fruitSprite as any).isSliced) {
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < closestDistance) {
          closestFruit = fruitSprite;
        }
      }
    } else {
      // Normal mode: check all fruits
      this.fruits.children.entries.forEach(fruit => {
        const fruitSprite = fruit as Phaser.GameObjects.Image;
        if (!fruitSprite.active || (fruitSprite as any).isSliced) return;

        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestFruit = fruitSprite;
        }
      });
    }

    return closestFruit;
  }

  checkFruitSlice(x: number, y: number): void {
    const sliceRadius = 65; // Adjusted for 2x fruit size
    let slicedCount = 0;

    // If we're in hourglass mode (activeGoldenFruit exists), only allow interaction with the hourglass
    if (this.activeGoldenFruit) {
      const fruitSprite = this.activeGoldenFruit;
      if (fruitSprite.active && !(fruitSprite as any).isSliced) {
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < sliceRadius) {
          this.sliceFruit(fruitSprite);
          slicedCount++;
        }
      }
    } else {
      // Normal mode: check all fruits
      this.fruits.children.entries.forEach(fruit => {
        const fruitSprite = fruit as Phaser.GameObjects.Image;
        if (!fruitSprite.active || (fruitSprite as any).isSliced) return;

        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < sliceRadius) {
          this.sliceFruit(fruitSprite);
          slicedCount++;
        }
      });
    }

    // Handle combo system
    if (slicedCount > 0) {
      this.handleCombo(slicedCount);
      this.checkSpectacularSlice(slicedCount);
    } else {
      // Check for near misses when no fruits were sliced
      this.detectNearMiss(x, y);
    }
  }

  private playWithVariance(sound?: Phaser.Sound.BaseSound, baseRate = 1, spread = 0.04): void {
    if (!sound) return;
    if (!PRESENTATION_ONLY) {
      sound.play({ rate: baseRate });
      return;
    }
    const rate = baseRate * (1 - spread + Math.random() * spread * 2);
    sound.play({ rate });
  }

  sliceFruit(fruit: Phaser.GameObjects.Image): void {
    const fruitData = (fruit as any).fruitData;

    if (fruitData.isBomb) {
      this.handleBombExplosion(fruit);
      return;
    }

    if (fruitData.isGolden) {
      this.handleGoldenFruitSlice(fruit);
      return; // Hourglass has special handling
    }

    // Mark as sliced
    (fruit as any).isSliced = true;
    this.totalSlices++;
    this.totalFruitsSliced++;
    this.lastSliceTime = this.time.now;

    // Increment slice streak
    this.currentSliceStreak++;
    this.events.emit('streakUpdated', this.currentSliceStreak);

    // Determine slice quality and calculate score multiplier
    const sliceQuality = this.calculateSliceQuality(fruit);
    let finalMultiplier = this.combo > 1 ? scoreConfig.comboMultiplier.value : 1;

    // Update slice chain progression
    this.updateSliceChain(sliceQuality);

    // Apply slice quality bonuses with enhanced effects
    if (sliceQuality === 'perfect') {
      this.perfectSlices++;
      this.currentPerfectStreak++;
      finalMultiplier *= scoreConfig.perfectSliceMultiplier.value;
      this.createPerfectSliceEffect(fruit);
      this.playWithVariance(this.perfectSliceSound, 1.15, 0.02);
      this.events.emit('perfectSlice', { x: fruit.x, y: fruit.y });
      this.checkPerfectStreak();
      this.checkOnFireMode();
    } else {
      // Reset perfect streak on normal slice
      if (this.currentPerfectStreak > 0) {
        this.currentPerfectStreak = 0;
      }
    }

    // Apply frenzy mode multiplier
    if (this.isFrenzyMode) {
      finalMultiplier *= scoreConfig.frenzyModeMultiplier.value;
    }

    // Play slice sound with pitch variation based on quality
    const sliceSound = this.fruitSliceSounds.get(fruitData.key);
    if (sliceSound) {
      const pitchMultiplier = sliceQuality === 'perfect' ? 1.15 : 1.0;
      this.playWithVariance(sliceSound, pitchMultiplier, 0.03);
    }

    // Create kaleidoscope blue wave slice effect
    this.createKaleidoscopeSliceEffect(fruit.x, fruit.y, sliceQuality);

    // Particle effects completely removed for clean gameplay experience

    // Calculate final score
    const basePoints = fruitData.points;
    const finalPoints = Math.floor(basePoints * finalMultiplier);
    this.score += finalPoints;

    // Show floating score text
    this.createFloatingScoreText(fruit.x, fruit.y, finalPoints, sliceQuality);

    // Check for frenzy mode activation
    this.checkAndActivateFrenzyMode();

    // Check for difficulty progression
    this.checkDifficultyProgression();

    // Check for enhanced difficulty mechanics
    this.updateEnhancedDifficulty();

    // Save progress (personal best will be checked at game end)
    this.saveProgress('totalFruitsSliced', this.totalFruitsSliced);

    // Create slice effect animation
    this.createSliceEffect(fruit, sliceQuality);

    // Remove fruit
    fruit.setActive(false);
    fruit.setVisible(false);

    // Update UI
    this.events.emit('scoreUpdated', this.score);
  }

  createKaleidoscopeSliceEffect(x: number, y: number, sliceQuality: string = 'normal'): void {
    // Wave slice effects completely removed for clean gameplay experience
  }

  private acquireHalves(textureKey: string) {
    if (!PRESENTATION_ONLY) return null;
    const slot = this.halvesPool.find(h => !h.busy);
    if (!slot) return null;
    slot.busy = true;
    slot.left.setTexture(textureKey);
    slot.right.setTexture(textureKey);
    slot.left.setVisible(true);
    slot.right.setVisible(true);
    return slot;
  }

  private releaseHalves(slot: { left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image; busy: boolean }) {
    if (!slot) return;
    slot.busy = false;
    slot.left.setVisible(false);
    slot.right.setVisible(false);
    slot.left.setPosition(-1000, -1000);
    slot.right.setPosition(-1000, -1000);
  }

  createSliceEffect(fruit: Phaser.GameObjects.Image, sliceQuality: string = 'normal'): void {
    // ORIGINAL behavior (create/destroy each time) when PRESENTATION_ONLY is false
    if (!PRESENTATION_ONLY) {
      const leftHalf = this.add.image(fruit.x - 12, fruit.y, fruit.texture.key);
      const rightHalf = this.add.image(fruit.x + 12, fruit.y, fruit.texture.key);

      utils.initScale(leftHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
      utils.initScale(rightHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);

      leftHalf.setCrop(0, 0, leftHalf.width / 2, leftHalf.height);
      rightHalf.setCrop(rightHalf.width / 2, 0, rightHalf.width / 2, rightHalf.height);

      const speedMultiplier = sliceQuality === 'perfect' ? 1.2 : 1.0;
      const distance = 120 * speedMultiplier;

      this.tweens.add({
        targets: leftHalf,
        x: leftHalf.x - distance,
        y: leftHalf.y + 60,
        rotation: -0.5 * speedMultiplier,
        alpha: 0,
        duration: 800,
        onComplete: () => leftHalf.destroy()
      });

      this.tweens.add({
        targets: rightHalf,
        x: rightHalf.x + distance,
        y: rightHalf.y + 60,
        rotation: 0.5 * speedMultiplier,
        alpha: 0,
        duration: 800,
        onComplete: () => rightHalf.destroy()
      });
      return;
    }

    // PRESENTATION-ONLY: pooled halves
    const slot = this.acquireHalves(fruit.texture.key);
    if (!slot) return;

    // Position & scale
    slot.left.setPosition(fruit.x - 12, fruit.y);
    slot.right.setPosition(fruit.x + 12, fruit.y);

    utils.initScale(slot.left, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    utils.initScale(slot.right, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);

    slot.left.setCrop(0, 0, slot.left.width / 2, slot.left.height);
    slot.right.setCrop(slot.right.width / 2, 0, slot.right.width / 2, slot.right.height);

    const speedMultiplier = sliceQuality === 'perfect' ? 1.2 : 1.0;
    const distance = 120 * speedMultiplier;

    this.tweens.add({
      targets: slot.left,
      x: slot.left.x - distance,
      y: slot.left.y + 60,
      rotation: -0.5 * speedMultiplier,
      alpha: 0,
      duration: 800,
      onComplete: () => {
        slot.left.setAlpha(1).setRotation(0);
        this.releaseHalves(slot);
      }
    });

    this.tweens.add({
      targets: slot.right,
      x: slot.right.x + distance,
      y: slot.right.y + 60,
      rotation: 0.5 * speedMultiplier,
      alpha: 0,
      duration: 800,
      onComplete: () => {
        slot.right.setAlpha(1).setRotation(0);
        this.releaseHalves(slot);
      }
    });
  }

  private getScoreText(): Phaser.GameObjects.Text | null {
    for (let i = 0; i < this.scoreTextPool.length; i++) {
      const t = this.scoreTextPool[i];
      if ((t as any).__free) {
        (t as any).__free = false;
        t.setVisible(true);
        return t;
      }
    }
    return null;
  }

  calculateSliceQuality(fruit: Phaser.GameObjects.Image): string {
    // Check for perfect slice based on timing or fruit position
    const timeSinceLastSlice = this.time.now - this.lastSliceTime;
    const perfectTimingWindow = gameplayConfig.perfectSliceWindow.value;

    // Perfect slice: based on timing or fruit position
    if (timeSinceLastSlice < perfectTimingWindow || this.isFruitInPerfectZone(fruit)) {
      return 'perfect';
    }

    return 'normal';
  }

  isFruitInPerfectZone(fruit: Phaser.GameObjects.Image): boolean {
    // Perfect zone is the center area of the screen
    const centerX = this.scale.gameSize.width / 2;
    const centerY = this.scale.gameSize.height / 2;
    const perfectZoneRadius = 200;

    const distance = Phaser.Math.Distance.Between(fruit.x, fruit.y, centerX, centerY);
    return distance < perfectZoneRadius;
  }

  createPerfectSliceEffect(fruit: Phaser.GameObjects.Image): void {
    // Perfect slice visual effects completely removed for clean gameplay experience
  }

  private showPerfectBadge(x: number, y: number): void {
    if (!PRESENTATION_ONLY) return;
    const t = this.getBannerText();
    if (!t) return;
    t.setText("PERFECT!").setStyle({ color: "#7CFC00" });
    t.setPosition(x, y - 60).setAlpha(0).setScale(0.6).setVisible(true);
    this.tweens.add({
      targets: t,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      y: y - 90,
      duration: 240,
      ease: "Back.Out(1.6)",
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          duration: 260,
          delay: 300,
          onComplete: () => { (t as any).__free = true; t.setVisible(false); }
        });
      }
    });
  }

  createFloatingScoreText(x: number, y: number, points: number, quality: string): void {
    if (!PRESENTATION_ONLY) return; // original removed visuals

    const t = this.getScoreText();
    if (!t) return;
    t.setText(`+${points}`);
    t.setPosition(x, y - 10);
    t.setStyle({
      color: quality === "perfect" ? "#fffb88" : "#ffe066"
    });
    t.setAlpha(0).setScale(0.9).setVisible(true);

    this.tweens.add({
      targets: t,
      y: y - 50,
      alpha: 1,
      duration: 180,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          duration: 250,
          delay: 220,
          onComplete: () => { (t as any).__free = true; t.setVisible(false); }
        });
      }
    });
  }

  private getBannerText(): Phaser.GameObjects.Text | null {
    for (let i = 0; i < this.uiBannerPool.length; i++) {
      const t = this.uiBannerPool[i];
      if ((t as any).__free) {
        (t as any).__free = false;
        t.setVisible(true).setAlpha(1).setScale(1);
        t.setPosition(this.scale.gameSize.width / 2, 120);
        return t;
      }
    }
    return null;
  }

  triggerScreenShake(intensity: number = 10): void {
    // Reduced duration and capped intensity to prevent visual artifacts
    this.cameras.main.shake(100, Math.min(intensity, 6));
  }

  // Achievement system completely removed as requested

  checkAndActivateFrenzyMode(): void {
    // Update max combo
    if (this.combo > this.maxCombo) {
      this.maxCombo = this.combo;
    }

    // Check for frenzy mode activation
    if (this.combo >= gameplayConfig.frenzyModeThreshold.value && !this.isFrenzyMode) {
      this.activateFrenzyMode();
    }
  }

  activateFrenzyMode(): void {
    this.isFrenzyMode = true;
    this.frenzyModeEndTime = this.time.now + gameplayConfig.frenzyModeDuration.value;
    this.playWithVariance(this.frenzyModeSound, 1, 0.03);

    // Use existing on-fire color matrix if available, or create a new one
    if (!this.frenzyColorMatrix) {
      if (this.onFireBrightness) {
        // Reuse the on-fire color matrix for frenzy effect to prevent conflicts
        this.frenzyColorMatrix = this.onFireBrightness;
      } else {
        this.frenzyColorMatrix = this.cameras.main.postFX.addColorMatrix();
      }
    }

    // Apply combined effects: add hue, maintain brightness if on-fire is active
    if (this.isOnFire && this.onFireBrightness === this.frenzyColorMatrix) {
      this.frenzyColorMatrix.hue(30).brightness(1.3);
    } else {
      this.frenzyColorMatrix.hue(30);
    }

    this.triggerScreenShake(12);

    // Show frenzy mode notification
    this.events.emit('frenzyModeActivated', {
      duration: gameplayConfig.frenzyModeDuration.value
    });

    // Faster fruit spawning during frenzy
    this.updateSpawnRate();
  }

  deactivateFrenzyMode(): void {
    this.isFrenzyMode = false;

    // Smoothly remove only the frenzy effect instead of clearing all
    if (this.frenzyColorMatrix) {
      this.tweens.addCounter({
        from: 30,
        to: 0,
        duration: 300,
        onUpdate: (tween) => {
          if (this.frenzyColorMatrix) {
            // If sharing with on-fire mode, maintain the brightness while reducing hue
            if (this.isOnFire && this.onFireBrightness === this.frenzyColorMatrix) {
              this.frenzyColorMatrix.hue(tween.getValue()).brightness(1.3);
            } else {
              this.frenzyColorMatrix.hue(tween.getValue());
            }
          }
        },
        onComplete: () => {
          if (this.frenzyColorMatrix) {
            // If sharing with on-fire mode, keep the brightness and reset hue
            if (this.isOnFire && this.onFireBrightness === this.frenzyColorMatrix) {
              this.frenzyColorMatrix.hue(0).brightness(1.3);
            } else {
              // Reset the effect to default values
              this.frenzyColorMatrix.hue(0);
              // Only set to null if not shared with on-fire mode
              if (this.onFireBrightness !== this.frenzyColorMatrix) {
                this.frenzyColorMatrix = null;
              }
            }

            // Clear reference if not shared
            if (this.onFireBrightness !== this.frenzyColorMatrix) {
              this.frenzyColorMatrix = null;
            }
          }
        }
      });
    }

    this.events.emit('frenzyModeDeactivated');

    // Restore normal spawn rate
    this.updateSpawnRate();
  }

  handleCombo(slicedCount: number): void {
    this.combo += slicedCount;

    // Update max combo
    if (this.combo > this.maxCombo) {
      this.maxCombo = this.combo;
    }

    // Reset combo timer
    if (this.comboTimer) {
      this.comboTimer.destroy();
    }

    this.comboTimer = this.time.delayedCall(gameplayConfig.comboTimeWindow.value, () => {
      this.combo = 0;
      this.events.emit('comboUpdated', this.combo);
    });

    // Create combo text effect for high combos
    if (this.combo >= 5) {
      this.createComboText(this.combo);
    }

    this.events.emit('comboUpdated', this.combo);
  }

  createComboText(comboCount: number): void {
    if (!PRESENTATION_ONLY) return;
    this.showComboBanner(`x${comboCount} COMBO!`);
  }

  private showComboBanner(text: string): void {
    if (!PRESENTATION_ONLY) return;
    const t = this.getBannerText();
    if (!t) return;
    t.setText(text).setAlpha(0).setScale(0.9).setStyle({ color: "#ffd94d" });
    this.tweens.add({
      targets: t,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: "Back.Out(1.6)",
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          duration: 260,
          delay: 420,
          onComplete: () => { (t as any).__free = true; t.setVisible(false); }
        });
      }
    });
  }

  selectWeightedFruit(): FruitType {
    // Calculate total weight
    const totalWeight = this.fruitTypes.reduce((sum, fruit) => sum + fruit.rarity, 0);

    // Generate random number within total weight
    const random = Math.random() * totalWeight;

    // Find the selected fruit based on cumulative weight
    let currentWeight = 0;
    for (const fruit of this.fruitTypes) {
      currentWeight += fruit.rarity;
      if (random <= currentWeight) {
        return fruit;
      }
    }

    // Fallback to random fruit (should never reach here)
    return Phaser.Utils.Array.GetRandom(this.fruitTypes);
  }

  playHourglassHitSound(sliceCount: number): void {
    // Play different sounds based on slice count for variety and progressively more satisfying effects
    if (sliceCount <= 5) {
      this.playWithVariance(this.hourglassHitSatisfyingSound, 1, 0.02);
    } else if (sliceCount <= 15) {
      if (sliceCount % 2 === 0) {
        this.playWithVariance(this.hourglassHitImpactSound, 1, 0.02);
      } else {
        this.playWithVariance(this.hourglassHitSatisfyingSound, 1, 0.02);
      }
    } else {
      this.playWithVariance(this.hourglassHitCascadeSound, 1, 0.02);
    }
  }

  handleGoldenFruitSlice(goldenFruit: Phaser.GameObjects.Image): void {
    const currentTime = this.time.now;

    // Check if this is the first slice of this hourglass
    const isFirstSlice = this.activeGoldenFruit !== goldenFruit;
    if (isFirstSlice) {
      this.initializeGoldenFruit(goldenFruit);
    }

    // No timing restrictions - allow hits anytime during hourglass mode for consistent scoring

    // Simple hit detection - just check if slicing near the hourglass
    const hitZone = this.checkHourglassPrecisionZone(goldenFruit);
    console.log(`Hourglass hit check: ${hitZone ? 'HIT' : 'MISS'} at (${this.input.activePointer.worldX}, ${this.input.activePointer.worldY}) vs hourglass at (${goldenFruit.x}, ${goldenFruit.y})`);
    if (!hitZone) {
      // Not close enough to the hourglass, ignore this slice
      console.log('Hit zone missed - ignoring slice');
      return;
    }

    // Perform the slice
    this.goldenFruitSliceCount++;
    this.goldenFruitLastSliceTime = currentTime;

    // Play impactful, dopamine-inducing sound effect
    this.playHourglassHitSound(this.goldenFruitSliceCount);

    // Increment slice streak for hourglass hits
    this.currentSliceStreak++;
    this.events.emit('streakUpdated', this.currentSliceStreak);

    // HOURGLASS LADDER SCORING SYSTEM (Max 500 points for 20 slices)
    const points = this.calculateHourglassPoints(this.goldenFruitSliceCount);
    console.log(`Hourglass slice ${this.goldenFruitSliceCount}: Adding ${points} points. Score before: ${this.score}`);
    this.score += points;
    console.log(`Score after: ${this.score}`);

    // Create minimal slice effect (no distracting text/popups)
    this.createMinimalGoldenSliceEffect(goldenFruit, this.goldenFruitSliceCount);

    // FRUIT NINJA DIFFICULTY: Rapid movement progression
    // Change movement pattern every 2 slices for constant challenge
    const newPhase = Math.min(6, Math.floor(this.goldenFruitSliceCount / 2)); // Change every 2 slices, up to phase 6
    const currentPhase = (this.activeGoldenFruit as any).currentMovementPhase || 0;

    if (newPhase > currentPhase) {
      (this.activeGoldenFruit as any).currentMovementPhase = newPhase;
      this.startHourglassMovementPhase(this.activeGoldenFruit, newPhase);
    }

    // Check if we've reached max slices
    if (this.goldenFruitSliceCount >= gameplayConfig.goldenFruitMaxSlices.value) {
      this.finalizeGoldenFruit();
    } else {
      // Reset timer for next slice opportunity with current shrinking window
      if (this.goldenFruitTimer) {
        this.goldenFruitTimer.destroy();
      }

      const currentSliceWindow = Math.max(100, gameplayConfig.goldenFruitSliceWindow.value - (this.goldenFruitSliceCount - 1) * 50);
      this.goldenFruitTimer = this.time.delayedCall(currentSliceWindow, () => {
        this.finalizeGoldenFruit();
      });
    }

    // Update UI
    this.events.emit('scoreUpdated', this.score);
    this.events.emit('goldenFruitSlice', {
      slice: this.goldenFruitSliceCount,
      points: points,
      totalSlices: gameplayConfig.goldenFruitMaxSlices.value,
      maxPossiblePoints: this.getTotalHourglassPossiblePoints(gameplayConfig.goldenFruitMaxSlices.value)
    });
  }

  initializeGoldenFruit(goldenFruit: Phaser.GameObjects.Image): void {
    this.activeGoldenFruit = goldenFruit;
    this.goldenFruitSliceCount = 0;
    this.goldenFruitLastSliceTime = this.time.now;

    // Handle other fruits to prevent unfair life loss during hourglass zoom mode
    this.handleOtherFruitsForGoldenMode();

    // Pause fruit spawning during hourglass mode
    this.pauseFruitSpawning();

    // Make the hourglass float in air (remove gravity and set gentle floating motion)
    const body = goldenFruit.body as Phaser.Physics.Arcade.Body;
    if (body) {
      // Stop all movement and make it float
      body.setVelocity(0, 0);
      body.setGravityY(0); // Remove gravity completely

      // Position it in a good floating spot
      const floatX = this.scale.gameSize.width / 2;
      const floatY = this.scale.gameSize.height / 2 - 50;
      goldenFruit.setPosition(floatX, floatY);

      // Set hourglass depth to be above all slice animations
      goldenFruit.setDepth(50);

      // CHALLENGING MECHANIC 3: Progressive movement patterns
      // Store initial position for movement reference
      (goldenFruit as any).initialX = floatX;
      (goldenFruit as any).initialY = floatY;
      (goldenFruit as any).currentMovementPhase = 0;

      // Start with gentle floating animation (will be replaced with more challenging patterns)
      this.startHourglassMovementPhase(goldenFruit, 0);
    }

    // Activate dramatic zoom effect (Fruit Ninja style)
    this.activateGoldenFruitZoom(goldenFruit);

    // Add golden glow effect
    this.addGoldenGlowEffect(goldenFruit);

    // Set up timeout for hourglass
    if (this.goldenFruitTimer) {
      this.goldenFruitTimer.destroy();
    }

    this.goldenFruitTimer = this.time.delayedCall(gameplayConfig.goldenFruitHoverDuration.value, () => {
      this.finalizeGoldenFruit();
    });
  }

  handleOtherFruitsForGoldenMode(): void {
    let autoSlicedCount = 0;
    let bombsRemoved = 0;

    // Go through all active fruits and handle them appropriately
    this.fruits.children.entries.forEach(fruit => {
      const fruitSprite = fruit as Phaser.GameObjects.Image;
      if (!fruitSprite.active || fruitSprite === this.activeGoldenFruit) return;

      const fruitData = (fruitSprite as any).fruitData;

      // Don't penalize player for regular fruits during hourglass mode
      if (!fruitData.isBomb && !fruitData.isGolden) {
        // Auto-slice regular fruits with visual effect but no score
        this.autoSliceRegularFruit(fruitSprite);
        autoSlicedCount++;
      } else if (fruitData.isBomb) {
        // Remove bombs safely to prevent accidental hits during hourglass zoom
        this.removeBombSafely(fruitSprite);
        bombsRemoved++;
      }
    });

    // Show notification if fruits were auto-handled
    if (autoSlicedCount > 0 || bombsRemoved > 0) {
      this.showAutoSliceNotification(autoSlicedCount, bombsRemoved);
    }
  }

  autoSliceRegularFruit(fruit: Phaser.GameObjects.Image): void {
    // Mark as sliced to prevent life loss
    (fruit as any).isSliced = true;

    const fruitData = (fruit as any).fruitData;

    // Create subtle slice effect (less dramatic than manual slices)
    this.createAutoSliceEffect(fruit);

    // Create small particle effect
    const emitter = this.juiceEmitters.get(fruitData.juiceColor);
    if (emitter) {
      emitter.setPosition(fruit.x, fruit.y);
      emitter.explode(5); // Smaller particle burst
    }

    // Remove fruit
    fruit.setActive(false);
    fruit.setVisible(false);
  }

  createAutoSliceEffect(fruit: Phaser.GameObjects.Image): void {
    // Create subtle slice effect for auto-sliced fruits
    const leftHalf = this.add.image(fruit.x - 8, fruit.y, fruit.texture.key);
    const rightHalf = this.add.image(fruit.x + 8, fruit.y, fruit.texture.key);

    // Use same size as original fruit
    utils.initScale(leftHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    utils.initScale(rightHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);

    // Set alpha to make it more subtle
    leftHalf.setAlpha(0.6);
    rightHalf.setAlpha(0.6);

    // Set crop to show only halves
    leftHalf.setCrop(0, 0, leftHalf.width / 2, leftHalf.height);
    rightHalf.setCrop(rightHalf.width / 2, 0, rightHalf.width / 2, rightHalf.height);

    // Animate halves flying apart (smaller movement)
    this.tweens.add({
      targets: leftHalf,
      x: leftHalf.x - 60,
      y: leftHalf.y + 30,
      rotation: -0.3,
      alpha: 0,
      duration: 600,
      onComplete: () => leftHalf.destroy()
    });

    this.tweens.add({
      targets: rightHalf,
      x: rightHalf.x + 60,
      y: rightHalf.y + 30,
      rotation: 0.3,
      alpha: 0,
      duration: 600,
      onComplete: () => rightHalf.destroy()
    });
  }

  removeBombSafely(bomb: Phaser.GameObjects.Image): void {
    // Simply remove bomb without explosion during hourglass mode
    bomb.setActive(false);
    bomb.setVisible(false);

    // Create small puff effect to indicate bomb was neutralized
    const emitter = this.juiceEmitters.get(0x666666);
    if (emitter) {
      emitter.setPosition(bomb.x, bomb.y);
      emitter.explode(3);
    }
  }

  pauseFruitSpawning(): void {
    if (this.fruitSpawnTimer) {
      this.fruitSpawnTimer.paused = true;
    }
  }

  resumeFruitSpawning(): void {
    if (this.fruitSpawnTimer) {
      this.fruitSpawnTimer.paused = false;
    }

    // PHYSICS SAFETY CHECK: Ensure all existing fruits have proper physics
    this.fruits.children.entries.forEach(fruit => {
      const fruitSprite = fruit as Phaser.GameObjects.Image;
      if (fruitSprite.active && fruitSprite.body) {
        const body = fruitSprite.body as Phaser.Physics.Arcade.Body;
        const fruitData = (fruitSprite as any).fruitData;

        // Only reset physics for non-hourglass fruits
        if (!fruitData || !fruitData.isGolden) {
          // Ensure proper gravity is applied to regular fruits
          if (Math.abs(body.gravity.y) < 100) { // If gravity is too low, fix it
            body.setGravityY(gameplayConfig.fruitGravity.value);
          }
        }
      }
    });
  }

  showAutoSliceNotification(autoSlicedCount: number, bombsRemoved: number): void {
    let message = "";

    if (autoSlicedCount > 0 && bombsRemoved > 0) {
      message = `${autoSlicedCount} FRUITS AUTO-SLICED • ${bombsRemoved} BOMBS CLEARED`;
    } else if (autoSlicedCount > 0) {
      message = `${autoSlicedCount} FRUITS AUTO-SLICED`;
    } else if (bombsRemoved > 0) {
      message = `${bombsRemoved} BOMBS CLEARED`;
    }

    if (message) {
      // Create floating notification text
      const notificationText = this.add.text(
        this.scale.gameSize.width / 2,
        this.scale.gameSize.height / 2 + 150,
        message,
        {
          fontSize: '24px',
          color: '#ffff00',
          fontFamily: 'SupercellMagic',
          stroke: '#000000',
          strokeThickness: 3,
          align: 'center'
        }
      );

      notificationText.setOrigin(0.5, 0.5);
      notificationText.setDepth(20);
      notificationText.setAlpha(0);

      // Animate notification
      this.tweens.add({
        targets: notificationText,
        alpha: 1,
        y: notificationText.y - 30,
        duration: 300,
        ease: 'Power2'
      });

      // Fade out after showing
      this.time.delayedCall(2000, () => {
        this.tweens.add({
          targets: notificationText,
          alpha: 0,
          y: notificationText.y - 20,
          duration: 300,
          ease: 'Power2',
          onComplete: () => notificationText.destroy()
        });
      });
    }
  }

  activateGoldenFruitZoom(goldenFruit: Phaser.GameObjects.Image): void {
    if (this.isGoldenFruitZoomed) return;

    this.isGoldenFruitZoomed = true;

    // Calculate zoom level and target position
    const zoomLevel = 1.8; // 1.8x zoom for dramatic effect
    const targetX = goldenFruit.x;
    const targetY = goldenFruit.y;

    // Create dramatic screen darkening overlay
    const overlay = this.add.rectangle(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      this.scale.gameSize.width,
      this.scale.gameSize.height,
      0x000000,
      0
    );
    overlay.setDepth(10); // Above everything except UI

    // Animate overlay fade-in
    this.tweens.add({
      targets: overlay,
      alpha: 0.4,
      duration: 300,
      ease: 'Power2'
    });

    // Store overlay reference for cleanup
    (this as any).goldenFruitOverlay = overlay;

    // Create dramatic zoom-in effect
    this.tweens.add({
      targets: this.cameras.main,
      zoom: zoomLevel,
      duration: 500,
      ease: 'Power2'
    });

    // Make camera follow the golden fruit smoothly
    this.cameras.main.stopFollow();
    this.cameras.main.startFollow(goldenFruit, true, 0.1, 0.1);

    // Initial smooth zoom to the golden fruit position
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: targetX - this.scale.gameSize.width / 2,
      scrollY: targetY - this.scale.gameSize.height / 2,
      duration: 500,
      ease: 'Power2'
    });

    // Add subtle screen edge glow effect
    const edgeGlow = this.add.graphics();
    edgeGlow.setDepth(15);
    edgeGlow.lineStyle(10, 0xffd700, 0.3); // Thinner line and much lower opacity
    edgeGlow.strokeRect(10, 10, this.scale.gameSize.width - 20, this.scale.gameSize.height - 20);
    edgeGlow.setAlpha(0);

    // Animate edge glow with lower maximum alpha
    this.tweens.add({
      targets: edgeGlow,
      alpha: 0.4, // Much more subtle maximum alpha
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Store glow reference for cleanup
    (this as any).goldenFruitEdgeGlow = edgeGlow;

    // Emit event for UI
    this.events.emit('goldenFruitZoomActivated');
  }

  deactivateGoldenFruitZoom(): void {
    if (!this.isGoldenFruitZoomed) return;

    this.isGoldenFruitZoomed = false;

    // Remove overlay
    const overlay = (this as any).goldenFruitOverlay;
    if (overlay) {
      this.tweens.add({
        targets: overlay,
        alpha: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => overlay.destroy()
      });
      (this as any).goldenFruitOverlay = null;
    }

    // Remove edge glow
    const edgeGlow = (this as any).goldenFruitEdgeGlow;
    if (edgeGlow) {
      this.tweens.add({
        targets: edgeGlow,
        alpha: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => edgeGlow.destroy()
      });
      (this as any).goldenFruitEdgeGlow = null;
    }

    // Add a brief delay before zoom out to let players enjoy the moment
    this.time.delayedCall(500, () => {
      // Stop following the golden fruit
      this.cameras.main.stopFollow();

      // Zoom out camera smoothly
      this.tweens.add({
        targets: this.cameras.main,
        zoom: 1,
        duration: 1000,
        ease: 'Power2'
      });

      // Return camera to center position
      this.tweens.add({
        targets: this.cameras.main,
        scrollX: 0,
        scrollY: 0,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => {
          // Reset camera to centered view
          this.cameras.main.centerOn(this.scale.gameSize.width / 2, this.scale.gameSize.height / 2);
        }
      });
    });

    // Emit event for UI
    this.events.emit('goldenFruitZoomDeactivated');
  }

  addGoldenGlowEffect(goldenFruit: Phaser.GameObjects.Image): void {
    // Create continuous golden particle emission
    const emitter = this.juiceEmitters.get(0xffd700);
    if (emitter) {
      emitter.setPosition(goldenFruit.x, goldenFruit.y);
      emitter.start();

      // Follow the fruit with particles
      const followParticles = this.time.addEvent({
        delay: 50,
        callback: () => {
          if (this.activeGoldenFruit === goldenFruit && goldenFruit.active) {
            emitter.setPosition(goldenFruit.x, goldenFruit.y);
          } else {
            emitter.stop();
            followParticles.destroy();
          }
        },
        loop: true
      });
    }

    // Add golden tint and glow
    goldenFruit.setTint(0xffff88);

    // Add pulsing scale effect
    this.tweens.add({
      targets: goldenFruit,
      scaleX: goldenFruit.scaleX * 1.1,
      scaleY: goldenFruit.scaleY * 1.1,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  createGoldenSliceEffect(goldenFruit: Phaser.GameObjects.Image, sliceNumber: number, points: number): void {
    const centerX = goldenFruit.x;
    const centerY = goldenFruit.y;

    // Cycle through bright royal purple, golden yellow, and bright green colors
    const colors = [0x6A0DAD, 0xFFD700, 0x00FF00]; // Royal purple, golden yellow, bright green
    const currentColor = colors[sliceNumber % colors.length];

    // Create subtle colorful screen flash - set depth below hourglass
    const flash = this.add.rectangle(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      this.scale.gameSize.width,
      this.scale.gameSize.height,
      currentColor,
      0.1 // Much more subtle flash
    );
    flash.setDepth(5); // Below hourglass depth

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 150,
      onComplete: () => flash.destroy()
    });

    // Create dramatic colorful slice line
    const angle = Math.random() * Math.PI * 2;
    const length = 200;

    const startX = centerX - Math.cos(angle) * length;
    const startY = centerY - Math.sin(angle) * length;
    const endX = centerX + Math.cos(angle) * length;
    const endY = centerY + Math.sin(angle) * length;

    const sliceLine = this.add.line(0, 0, startX, startY, endX, endY, currentColor);
    sliceLine.setLineWidth(12 + sliceNumber * 2); // Thicker with each slice
    sliceLine.setAlpha(1);
    sliceLine.setBlendMode(Phaser.BlendModes.ADD);
    sliceLine.setDepth(5); // Below hourglass depth

    this.tweens.add({
      targets: sliceLine,
      alpha: 0,
      duration: 600,
      ease: 'Power2',
      onComplete: () => sliceLine.destroy()
    });

    // Intense particle burst with current color
    const emitter = this.juiceEmitters.get(currentColor);
    if (emitter) {
      emitter.setPosition(centerX, centerY);
      emitter.explode(15 + sliceNumber * 5); // More particles with each slice
    }

    // Screen shake with increasing intensity
    this.cameras.main.shake(100 + sliceNumber * 50, 0.01);

    // Score popup with increasing size (removed text but kept logic)
    this.createScorePopup(centerX, centerY - 50, `+${points}`, currentColor, 1 + sliceNumber * 0.2);

    // Play slice sound with increasing pitch
    const sliceSound = this.fruitSliceSounds.get('golden_fruit_powerup');
    if (sliceSound) {
      // Increase pitch with each slice by adjusting playback rate
      const rate = 1 + sliceNumber * 0.2;
      this.playWithVariance(sliceSound, rate, 0.02);
    }
  }

  finalizeGoldenFruit(): void {
    if (!this.activeGoldenFruit) return;

    // Clean completion without cluttering text messages

    // Create final explosion effect
    this.createFinalGoldenExplosion(this.activeGoldenFruit);

    // Wait for dramatic effect before starting zoom out
    this.time.delayedCall(1500, () => {
      // Deactivate zoom effect after dramatic pause
      this.deactivateGoldenFruitZoom();

      // Set brief cooldown period after golden fruit for gentle transition
      this.postGoldenFruitCooldown = this.time.now + 3000; // 3 second cooldown

      // Resume fruit spawning after golden mode
      this.resumeFruitSpawning();

      // Remove the golden fruit after zoom animation starts
      if (this.activeGoldenFruit) {
        // PHYSICS CLEANUP: Restore normal gravity before deactivating
        const body = this.activeGoldenFruit.body as Phaser.Physics.Arcade.Body;
        if (body) {
          body.setGravityY(gameplayConfig.fruitGravity.value);
        }

        this.activeGoldenFruit.setActive(false);
        this.activeGoldenFruit.setVisible(false);
      }

      // Clean up
      this.activeGoldenFruit = null;
      this.goldenFruitSliceCount = 0;
      this.goldenFruitLastSliceTime = 0;

      if (this.goldenFruitTimer) {
        this.goldenFruitTimer.destroy();
        this.goldenFruitTimer = undefined;
      }
    });
  }

  createFinalGoldenExplosion(goldenFruit: Phaser.GameObjects.Image): void {
    const centerX = goldenFruit.x;
    const centerY = goldenFruit.y;

    // Colors: royal purple, golden yellow, bright green
    const colors = [0x6A0DAD, 0xFFD700, 0x00FF00];

    // Create ultra-massive colorful explosion effect with more lines
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI * 2) / 16;
      const length = 300 + Math.random() * 100; // Varied length for more dynamic effect
      const currentColor = colors[i % colors.length]; // Cycle through colors

      const startX = centerX;
      const startY = centerY;
      const endX = centerX + Math.cos(angle) * length;
      const endY = centerY + Math.sin(angle) * length;

      const explosionLine = this.add.line(0, 0, startX, startY, endX, endY, currentColor);
      explosionLine.setLineWidth(15 + Math.random() * 10); // Varied thickness
      explosionLine.setAlpha(1);
      explosionLine.setBlendMode(Phaser.BlendModes.ADD);
      explosionLine.setDepth(5); // Below hourglass depth

      this.tweens.add({
        targets: explosionLine,
        alpha: 0,
        scaleX: 0.1,
        scaleY: 0.1,
        duration: 1200 + Math.random() * 400, // Staggered duration for lasting effect
        ease: 'Power2',
        onComplete: () => explosionLine.destroy()
      });
    }

    // Create expanding colorful rings
    for (let ring = 0; ring < 3; ring++) {
      const delayTime = ring * 200;
      const ringColor = colors[ring % colors.length];

      this.time.delayedCall(delayTime, () => {
        const ringGraphics = this.add.graphics();
        ringGraphics.lineStyle(8, ringColor, 0.8);
        ringGraphics.strokeCircle(centerX, centerY, 50);
        ringGraphics.setBlendMode(Phaser.BlendModes.ADD);
        ringGraphics.setDepth(5); // Below hourglass depth

        this.tweens.add({
          targets: ringGraphics,
          scaleX: 8,
          scaleY: 8,
          alpha: 0,
          duration: 1000,
          ease: 'Power2',
          onComplete: () => ringGraphics.destroy()
        });
      });
    }

    // Multiple massive particle explosions with different colors
    colors.forEach((color, index) => {
      const emitter = this.juiceEmitters.get(color);
      if (emitter) {
        emitter.setPosition(centerX, centerY);
        this.time.delayedCall(index * 100, () => {
          emitter.explode(30 + index * 10); // Staggered particle bursts
        });
      }
    });

    // Extended screen shake for maximum impact
    this.cameras.main.shake(300, 0.015);

    // Score popup animations completely removed for clean gameplay experience

    // Create a subtle multi-colored screen flash that fades slowly
    const finalFlash = this.add.rectangle(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      this.scale.gameSize.width,
      this.scale.gameSize.height,
      0xFFD700, // Keep golden as the dominant final flash color
      0.2 // Much more subtle final flash
    );
    finalFlash.setDepth(20); // High depth for screen flash but still below UI

    this.tweens.add({
      targets: finalFlash,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => finalFlash.destroy()
    });
  }

  createScorePopup(x: number, y: number, text: string, color: number, scale: number = 1): void {
    // Score popup animations completely removed for clean gameplay experience
  }

  handleHourglassMiss(): void {
    // MISS PENALTY: Reduce slice count and show punishment
    if (this.goldenFruitSliceCount > 0) {
      this.goldenFruitSliceCount = Math.max(0, this.goldenFruitSliceCount - 2); // Lose 2 slices!
    }

    // Create dramatic miss effect
    this.createHourglassMissEffect();

    // If too many misses, end the hourglass mode early
    if (this.goldenFruitSliceCount <= 0) {
      this.finalizeGoldenFruit();
      return;
    }

    // Reset timer with current (reduced) window
    if (this.goldenFruitTimer) {
      this.goldenFruitTimer.destroy();
    }

    const currentSliceWindow = Math.max(100, gameplayConfig.goldenFruitSliceWindow.value - (this.goldenFruitSliceCount - 1) * 50);
    this.goldenFruitTimer = this.time.delayedCall(currentSliceWindow, () => {
      this.finalizeGoldenFruit();
    });

    // Update UI to show reduced slice count
    this.events.emit('goldenFruitSlice', {
      slice: this.goldenFruitSliceCount,
      points: 0,
      totalSlices: gameplayConfig.goldenFruitMaxSlices.value,
      missed: true
    });
  }

  checkHourglassPrecisionZone(goldenFruit: Phaser.GameObjects.Image): boolean {
    // Simplified hit detection - just check if slice is near the hourglass
    const pointer = this.input.activePointer;
    const sliceX = pointer.worldX;
    const sliceY = pointer.worldY;
    const hourglassX = goldenFruit.x;
    const hourglassY = goldenFruit.y;

    const deltaX = sliceX - hourglassX;
    const deltaY = sliceY - hourglassY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Simple radius-based hit detection with generous radius
    const hitRadius = 80; // Generous hit area that doesn't shrink

    console.log(`Distance check: ${distance.toFixed(1)}px from hourglass (radius: ${hitRadius}px) = ${distance <= hitRadius ? 'HIT' : 'MISS'}`);

    return distance <= hitRadius;
  }

  startHourglassMovementPhase(goldenFruit: Phaser.GameObjects.Image, phase: number): void {
    // Stop all previous tweens
    this.tweens.killTweensOf(goldenFruit);

    const initialX = (goldenFruit as any).initialX;
    const initialY = (goldenFruit as any).initialY;

    switch (phase) {
      case 0: // Gentle floating (slices 1-2) - still easy
        this.tweens.add({
          targets: goldenFruit,
          y: initialY - 15,
          duration: 1500,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1
        });
        break;

      case 1: // Fast drift (slices 3-4) - immediate challenge
        this.tweens.add({
          targets: goldenFruit,
          x: initialX - 60,
          y: initialY - 20,
          duration: 800,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1
        });
        break;

      case 2: // Rapid zigzag (slices 5-6) - tracking required
        this.createRapidZigzag(goldenFruit, initialX, initialY);
        break;

      case 3: // Figure-8 chaos (slices 7-8) - pattern prediction
        this.createChaosEight(goldenFruit, initialX, initialY);
        break;

      case 4: // Erratic burst (slices 9-10) - reaction test
        this.createErraticBurst(goldenFruit, initialX, initialY);
        break;

      case 5: // Speed demon (slices 11-12) - ultra fast
        this.createSpeedDemon(goldenFruit, initialX, initialY);
        break;

      case 6: // Nightmare mode (slices 13+) - maximum difficulty
        this.createNightmareMovement(goldenFruit, initialX, initialY);
        break;
    }
  }

  createRapidZigzag(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const zigzag = () => {
      const targetX = initialX + (Math.random() - 0.5) * 80;
      const targetY = initialY + (Math.random() - 0.5) * 50;

      this.tweens.add({
        targets: goldenFruit,
        x: targetX,
        y: targetY,
        duration: 300 + Math.random() * 200,
        ease: 'Power1',
        onComplete: zigzag
      });
    };
    zigzag();
  }

  createChaosEight(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    let startTime = this.time.now;
    this.tweens.add({
      targets: goldenFruit,
      duration: 50,
      repeat: -1,
      onUpdate: () => {
        const t = (this.time.now - startTime) * 0.006; // Faster than before
        goldenFruit.x = initialX + 70 * Math.cos(t);
        goldenFruit.y = initialY + 40 * Math.sin(t * 2);
      }
    });
  }

  createErraticBurst(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const burst = () => {
      const targetX = initialX + (Math.random() - 0.5) * 100;
      const targetY = initialY + (Math.random() - 0.5) * 70;

      this.tweens.add({
        targets: goldenFruit,
        x: targetX,
        y: targetY,
        duration: 150 + Math.random() * 150, // Very fast movements
        ease: 'Power2',
        onComplete: burst
      });
    };
    burst();
  }

  createSpeedDemon(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const speedMove = () => {
      const targetX = initialX + (Math.random() - 0.5) * 120;
      const targetY = initialY + (Math.random() - 0.5) * 80;

      this.tweens.add({
        targets: goldenFruit,
        x: targetX,
        y: targetY,
        duration: 100 + Math.random() * 100, // Ultra fast
        ease: 'Power3',
        onComplete: speedMove
      });
    };
    speedMove();
  }

  createNightmareMovement(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const nightmare = () => {
      const targetX = initialX + (Math.random() - 0.5) * 140;
      const targetY = initialY + (Math.random() - 0.5) * 90;

      this.tweens.add({
        targets: goldenFruit,
        x: targetX,
        y: targetY,
        duration: 80 + Math.random() * 80, // Insanely fast
        ease: 'Power4',
        onComplete: nightmare
      });
    };
    nightmare();
  }

  calculateHourglassPoints(sliceNumber: number): number {
    // SIMPLE LADDER: 25 points per hit, totaling exactly 500 for 20 hits
    if (sliceNumber >= 1 && sliceNumber <= 20) {
      return 25; // Each hit gives 25 points
    }

    return 0; // No points for invalid slice numbers
  }

  getTotalHourglassPossiblePoints(maxSlices: number): number {
    // Calculate total possible points for a given number of slices
    let total = 0;
    for (let i = 1; i <= Math.min(maxSlices, 20); i++) {
      total += this.calculateHourglassPoints(i);
    }
    return total;
  }

  private getJuice(): Phaser.GameObjects.Graphics | null {
    for (let i = 0; i < this.juiceBurstPool.length; i++) {
      const g = this.juiceBurstPool[i];
      if ((g as any).__free) {
        (g as any).__free = false;
        g.setVisible(true);
        g.clear();
        return g;
      }
    }
    return null;
  }

  createMinimalGoldenSliceEffect(goldenFruit: Phaser.GameObjects.Image, sliceNumber: number): void {
    const centerX = goldenFruit.x;
    const centerY = goldenFruit.y;

    // Minimal visual feedback - just a quick flash and slice line
    const colors = [0x6A0DAD, 0xFFD700, 0x00FF00];
    const currentColor = colors[sliceNumber % colors.length];

    // Quick slice line only
    const angle = Math.random() * Math.PI * 2;
    const length = 80; // Shorter than before

    const startX = centerX - Math.cos(angle) * length;
    const startY = centerY - Math.sin(angle) * length;
    const endX = centerX + Math.cos(angle) * length;
    const endY = centerY + Math.sin(angle) * length;

    const sliceLine = this.add.line(0, 0, startX, startY, endX, endY, currentColor);
    sliceLine.setLineWidth(6); // Thinner line
    sliceLine.setAlpha(0.8);
    sliceLine.setDepth(5);

    this.tweens.add({
      targets: sliceLine,
      alpha: 0,
      duration: 200, // Much faster fade
      ease: 'Power2',
      onComplete: () => sliceLine.destroy()
    });

    // Minimal particle burst (pooled circle)
    if (PRESENTATION_ONLY) {
      const g = this.getJuice();
      if (g) {
        g.fillStyle(currentColor, 0.9);
        g.fillCircle(centerX, centerY, 10);
        this.tweens.add({
          targets: g,
          alpha: 0,
          scaleX: 2.2,
          scaleY: 2.2,
          duration: 220,
          onComplete: () => { (g as any).__free = true; g.setVisible(false); g.setAlpha(1).setScale(1); }
        });
      }
    }
  }

  createHourglassMissEffect(): void {
    if (!this.activeGoldenFruit) return;

    const centerX = this.activeGoldenFruit.x;
    const centerY = this.activeGoldenFruit.y;

    // Red miss flash
    const missFlash = this.add.rectangle(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      this.scale.gameSize.width,
      this.scale.gameSize.height,
      0xFF0000,
      0.3
    );
    missFlash.setDepth(5);

    this.tweens.add({
      targets: missFlash,
      alpha: 0,
      duration: 200,
      onComplete: () => missFlash.destroy()
    });

    // "MISS!" text
    const missText = this.add.text(centerX, centerY - 80, 'MISS!', {
      fontSize: '36px',
      color: '#FF0000',
      fontFamily: 'SupercellMagic',
      stroke: '#000000',
      strokeThickness: 4
    });
    missText.setOrigin(0.5, 0.5);
    missText.setDepth(100);

    // Animate miss text
    this.tweens.add({
      targets: missText,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      y: centerY - 120,
      duration: 800,
      ease: 'Power2',
      onComplete: () => missText.destroy()
    });

    // Screen shake for miss
    this.cameras.main.shake(200, 0.02);
  }

  handleBombExplosion(bomb: Phaser.GameObjects.Image): void {
    // Play explosion sound
    this.playWithVariance(this.bombExplosionSound, 1, 0.03);

    // Create screen flash
    const flash = this.add.rectangle(
      this.scale.gameSize.width / 2,
      this.scale.gameSize.height / 2,
      this.scale.gameSize.width,
      this.scale.gameSize.height,
      0xffffff,
      0.8
    );
    flash.setDepth(1000);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy()
    });

    // Create multiple explosion rings for more dramatic effect
    for (let i = 0; i < 3; i++) {
      const explosion = this.add.circle(bomb.x, bomb.y, 40 + (i * 20), i === 0 ? 0xff0000 : 0xff4444, 0.6 - (i * 0.15));
      this.tweens.add({
        targets: explosion,
        scaleX: 4 + (i * 0.5),
        scaleY: 4 + (i * 0.5),
        alpha: 0,
        duration: 600 + (i * 100),
        delay: i * 50,
        onComplete: () => explosion.destroy()
      });
    }

    // Screen shake
    this.cameras.main.shake(400, 15);

    // Remove bomb
    bomb.setActive(false);
    bomb.setVisible(false);

    // End game immediately (classic Fruit Ninja behavior)
    this.gameOver();
  }

  startFruitSpawning(): void {
    this.updateSpawnRate();
  }

  updateSpawnRate(): void {
    if (this.fruitSpawnTimer) {
      this.fruitSpawnTimer.destroy();
    }

    // Calculate spawn rate using effective difficulty level
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();
    let spawnRate = this.calculateDifficultyValue(
      effectiveDifficultyLevel,
      gameplayConfig.minSpawnRate.value,
      gameplayConfig.maxSpawnRate.value,
      8 // Reach minimum spawn rate at level 8
    );

    // Faster spawning during frenzy mode
    if (this.isFrenzyMode) {
      spawnRate *= 0.6; // 40% faster spawning
    }

    // Enhanced difficulty modifiers
    if (this.rapidFireMode) {
      spawnRate *= 0.4; // 60% faster spawning during rapid fire
    }

    if (this.chaosMode) {
      spawnRate *= 0.3; // 70% faster spawning during chaos mode
    }

    this.fruitSpawnTimer = this.time.addEvent({
      delay: spawnRate,
      callback: this.spawnFruit,
      callbackScope: this,
      loop: true
    });
  }

  spawnFruit(): void {
    if (this.isGameOver || this.isPaused) return;

    // Use effective difficulty level for all spawning calculations
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();

    // Calculate difficulty-based parameters using effective level
    let multiFruitChance = this.calculateDifficultyValue(
      effectiveDifficultyLevel,
      gameplayConfig.minMultiFruitChance.value,
      gameplayConfig.maxMultiFruitChance.value,
      6 // Reach max multi-fruit chance at level 6
    );

    // Calculate max fruits count based on effective difficulty
    const maxFruits = Math.min(
      2 + Math.floor(effectiveDifficultyLevel / 2), // Add 1 fruit every 2 levels
      gameplayConfig.maxMultiFruitCount.value
    );

    // Check if we should spawn multiple fruits for combo opportunities
    const shouldSpawnMultiple = Math.random() < multiFruitChance;
    const spawnCount = shouldSpawnMultiple ?
      Phaser.Math.Between(2, maxFruits) : 1;

    // Enhanced difficulty mechanics
    if (this.chaosMode && Math.random() < gameplayConfig.chaosSpawnChance.value) {
      this.createChaosPattern(spawnCount);
    } else if (this.rapidFireMode && Math.random() < gameplayConfig.rapidFireChance.value) {
      this.createRapidFireBurst();
    } else if (effectiveDifficultyLevel >= 6 && spawnCount > 1 && Math.random() < gameplayConfig.challengingPatternChance.value) {
      this.createChallengingPattern(spawnCount);
    } else {
      // Normal spawning
      for (let i = 0; i < spawnCount; i++) {
        this.createSingleFruit(i, spawnCount);
      }
    }
  }

  createChallengingPattern(spawnCount: number): void {
    // Create patterns that mix bombs with fruits in challenging ways
    const patterns = ['bomb-sandwich', 'criss-cross-bombs', 'bomb-flanks'];
    const chosenPattern = Phaser.Utils.Array.GetRandom(patterns);

    switch (chosenPattern) {
      case 'bomb-sandwich':
        // Place bomb in the middle of fruits
        for (let i = 0; i < spawnCount; i++) {
          const forceBomb = i === Math.floor(spawnCount / 2);
          this.createSingleFruit(i, spawnCount, forceBomb ? 'bomb' : 'fruit');
        }
        break;

      case 'criss-cross-bombs':
        // Alternating bomb and fruit in criss-cross pattern
        for (let i = 0; i < spawnCount; i++) {
          const forceBomb = i % 2 === 0 && Math.random() < 0.4;
          this.createSingleFruit(i, spawnCount, forceBomb ? 'bomb' : 'fruit', 'criss-cross');
        }
        break;

      case 'bomb-flanks':
        // Place bombs on the sides with fruits in middle
        for (let i = 0; i < spawnCount; i++) {
          const forceBomb = (i === 0 || i === spawnCount - 1) && Math.random() < 0.5;
          this.createSingleFruit(i, spawnCount, forceBomb ? 'bomb' : 'fruit');
        }
        break;
    }
  }

  createSingleFruit(index: number, totalCount: number, forceType?: string, forcePattern?: string): void {
    // Determine what to spawn
    let spawnKey: string;
    let fruitData: any;

    // Calculate bomb chance using effective difficulty level
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();
    const bombChance = this.calculateDifficultyValue(
      effectiveDifficultyLevel,
      gameplayConfig.minBombChance.value,
      gameplayConfig.maxBombChance.value,
      6 // Reach max bomb chance at level 6
    );

    const random = Math.random();

    // Check if we're forcing a specific type
    if (forceType === 'bomb') {
      // Force spawn bomb
      spawnKey = "bomb_object";
      fruitData = {
        key: spawnKey,
        isBomb: true,
        isGolden: false,
        juiceColor: 0x000000,
        points: 0
      };
    } else if (forceType === 'fruit') {
      // Force spawn regular fruit using weighted selection
      const fruitType = this.selectWeightedFruit();
      spawnKey = fruitType.key;
      fruitData = {
        key: spawnKey,
        isBomb: false,
        isGolden: false,
        juiceColor: fruitType.juiceColor,
        points: fruitType.points
      };
    } else {
      // Normal random spawning
      if (random < bombChance) {
        // Spawn bomb
        spawnKey = "bomb_object";
        fruitData = {
          key: spawnKey,
          isBomb: true,
          isGolden: false,
          juiceColor: 0x000000,
          points: 0
        };
      } else if (random < bombChance + gameplayConfig.goldenFruitChance.value) {
        // Spawn golden fruit
        spawnKey = "golden_fruit_powerup";
        fruitData = {
          key: spawnKey,
          isBomb: false,
          isGolden: true,
          juiceColor: 0xffd700,
          points: scoreConfig.goldenFruitPoints.value
        };
      } else {
        // Spawn regular fruit using weighted selection for rarity
        const fruitType = this.selectWeightedFruit();
        spawnKey = fruitType.key;
        fruitData = {
          key: spawnKey,
          isBomb: false,
          isGolden: false,
          juiceColor: fruitType.juiceColor,
          points: fruitType.points
        };
      }
    }

    // Determine throwing pattern based on difficulty and randomness (or force pattern)
    const throwPattern = forcePattern || this.getThrowingPattern(effectiveDifficultyLevel, totalCount, index);
    const trajectory = this.calculateThrowTrajectory(throwPattern, index, totalCount);

    const fruit = this.add.image(trajectory.spawnX, trajectory.spawnY, spawnKey);

    // Set fruit depth to appear above trails (trails are at depth -2, slice effects at -1)
    fruit.setDepth(0);

    // Make hourglass 1.5x bigger than other objects
    const fruitSize = fruitData.isGolden ? gameplayConfig.fruitSize.value * 1.5 : gameplayConfig.fruitSize.value;
    utils.initScale(fruit, { x: 0.5, y: 0.5 }, undefined, fruitSize);

    // Add physics
    this.physics.add.existing(fruit);
    const body = fruit.body as Phaser.Physics.Arcade.Body;

    // Enhanced difficulty modifications
    const totalDifficultyLevel = this.getTotalDifficultyLevel();

    // Apply speed increases based on difficulty with caps to prevent fruits shooting out of screen
    const rawSpeedMultiplier = 1 + (totalDifficultyLevel * gameplayConfig.fruitSpeedIncrease.value);
    const speedMultiplier = Math.min(rawSpeedMultiplier, 1.3); // Cap at 1.3x to prevent excessive speeds
    const gravityMultiplier = 1 + (totalDifficultyLevel * gameplayConfig.gravityIncrease.value);

    // Check for speed boost fruit
    let finalVelocityX = trajectory.velocityX;
    let finalVelocityY = trajectory.velocityY;

    const hasSpeedBoost = Math.random() < gameplayConfig.speedBoostChance.value && totalDifficultyLevel >= 3;
    if (hasSpeedBoost) {
      fruitData.hasSpeedBoost = true;
      const extraSpeed = 1.25; // Reduced from 50% to 25% faster
      finalVelocityX *= extraSpeed;
      finalVelocityY *= extraSpeed;
    }

    // Apply calculated trajectory with difficulty scaling
    body.setVelocity(finalVelocityX * speedMultiplier, finalVelocityY * speedMultiplier);

    // PHYSICS SAFETY: Ensure proper gravity for all fruit types
    if (fruitData.isGolden && this.activeGoldenFruit === fruit) {
      // Hourglass gets special zero gravity when it's the active one
      body.setGravityY(0);
    } else {
      // All other fruits (including inactive hourglasses) get normal gravity
      body.setGravityY(gameplayConfig.fruitGravity.value * gravityMultiplier);
    }

    // Store fruit data and throw pattern info
    (fruit as any).fruitData = fruitData;
    (fruit as any).isSliced = false;
    (fruit as any).throwPattern = throwPattern;

    // Add to group
    this.fruits.add(fruit);

    // Add rotation with slight variation for visual appeal
    const rotationSpeed = throwPattern === 'criss-cross' ?
      1800 + Phaser.Math.Between(-600, 600) : // Faster rotation for criss-cross
      1800 + Phaser.Math.Between(-400, 400);

    this.tweens.add({
      targets: fruit,
      angle: 360,
      duration: rotationSpeed,
      repeat: -1
    });

    // Subtle squash/settle (scale only; physics untouched)
    if (PRESENTATION_ONLY) {
      const sx = fruit.scaleX, sy = fruit.scaleY;
      fruit.setScale(sx * 0.92, sy * 1.08);
      this.tweens.add({
        targets: fruit,
        scaleX: sx,
        scaleY: sy,
        duration: 140,
        ease: "Quad.easeOut"
      });
    }

    // Add trail effect for flying objects
    this.createFruitTrail(fruit, fruitData);

    // Add magical sparkles for hourglass
    if (fruitData.isGolden) {
      this.createHourglassSparkles(fruit);
    }
  }

  getThrowingPattern(difficultyLevel: number, totalCount: number, index: number): string {
    // Higher difficulty = more challenging patterns
    const patterns = ['classic', 'left-to-right', 'right-to-left', 'criss-cross', 'side-throw'];

    // Early game: mostly classic throws
    if (difficultyLevel < gameplayConfig.sideThrowStartLevel.value) {
      return Phaser.Utils.Array.GetRandom(['classic', 'classic', 'left-to-right']);
    }

    // Mid game: introduce side throws and directional variety
    if (difficultyLevel < gameplayConfig.crissTrajectoryStartLevel.value) {
      return Phaser.Utils.Array.GetRandom(['classic', 'left-to-right', 'right-to-left', 'side-throw']);
    }

    // Late game: maximum chaos with criss-crossing
    if (difficultyLevel >= gameplayConfig.maxChaosLevel.value) {
      // Higher chance for complex patterns in multi-fruit spawns
      if (totalCount > 1) {
        return Phaser.Utils.Array.GetRandom(['criss-cross', 'criss-cross', 'side-throw', 'left-to-right', 'right-to-left']);
      }
    }

    // General high difficulty pattern selection with progressive complexity
    const availablePatterns = ['classic'];

    if (difficultyLevel >= gameplayConfig.sideThrowStartLevel.value) {
      availablePatterns.push('left-to-right', 'right-to-left', 'side-throw');
    }

    if (difficultyLevel >= gameplayConfig.crissTrajectoryStartLevel.value) {
      availablePatterns.push('criss-cross');
    }

    return Phaser.Utils.Array.GetRandom(availablePatterns);
  }

  calculateThrowTrajectory(pattern: string, index: number, totalCount: number): { spawnX: number, spawnY: number, velocityX: number, velocityY: number } {
    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;
    const baseSpeed = gameplayConfig.fruitLaunchSpeed.value;

    let spawnX: number, spawnY: number, velocityX: number, velocityY: number;

    switch (pattern) {
      case 'left-to-right':
        // Spawn from left side, throw towards right (reduced intensity)
        spawnX = -50;
        spawnY = screenHeight * 0.7 + Phaser.Math.Between(-50, 50);
        velocityX = Phaser.Math.Between(280, 400); // Reduced from 350-500 to 280-400
        velocityY = Phaser.Math.Between(-550, -420); // Reduced from -650/-500 to -550/-420
        break;

      case 'right-to-left':
        // Spawn from right side, throw towards left (reduced intensity)
        spawnX = screenWidth + 50;
        spawnY = screenHeight * 0.7 + Phaser.Math.Between(-50, 50);
        velocityX = Phaser.Math.Between(-400, -280); // Reduced from -500/-350 to -400/-280
        velocityY = Phaser.Math.Between(-550, -420); // Reduced from -650/-500 to -550/-420
        break;

      case 'criss-cross':
        // Alternating directions for multiple fruits (reduced intensity)
        if (index % 2 === 0) {
          // Even index: left to right
          spawnX = -50;
          spawnY = screenHeight * 0.8 + Phaser.Math.Between(-30, 30);
          velocityX = Phaser.Math.Between(320, 420); // Reduced from 400-550 to 320-420
          velocityY = Phaser.Math.Between(-600, -480); // Reduced from -700/-550 to -600/-480
        } else {
          // Odd index: right to left
          spawnX = screenWidth + 50;
          spawnY = screenHeight * 0.8 + Phaser.Math.Between(-30, 30);
          velocityX = Phaser.Math.Between(-420, -320); // Reduced from -550/-400 to -420/-320
          velocityY = Phaser.Math.Between(-600, -480); // Reduced from -700/-550 to -600/-480
        }
        break;

      case 'side-throw':
        // Randomly choose left or right side throw (reduced intensity)
        if (Math.random() < 0.5) {
          // From left
          spawnX = -50;
          spawnY = screenHeight * (0.5 + Math.random() * 0.2);
          velocityX = Phaser.Math.Between(250, 380); // Reduced from 300-450 to 250-380
          velocityY = Phaser.Math.Between(-520, -400); // Reduced from -600/-450 to -520/-400
        } else {
          // From right
          spawnX = screenWidth + 50;
          spawnY = screenHeight * (0.5 + Math.random() * 0.2);
          velocityX = Phaser.Math.Between(-380, -250); // Reduced from -450/-300 to -380/-250
          velocityY = Phaser.Math.Between(-520, -400); // Reduced from -600/-450 to -520/-400
        }
        break;

      default: // 'classic'
        // Traditional bottom-up throw with some spread
        if (totalCount === 1) {
          // Single fruit: spawn in central 60% of screen
          const centralZone = screenWidth * 0.6;
          const startPos = screenWidth * 0.2;
          spawnX = startPos + Math.random() * centralZone;
        } else {
          // Multiple fruits: spread across central 70% of screen
          const centralZone = screenWidth * 0.7;
          const startPos = screenWidth * 0.15;
          const spacing = centralZone / Math.max(totalCount - 1, 1);
          spawnX = startPos + (spacing * index) + Phaser.Math.Between(-30, 30);
        }

        spawnY = screenHeight + 50;

        // Classic upward launch with horizontal variation
        const speedVariation = totalCount > 1 ? Phaser.Math.Between(-80, 100) : Phaser.Math.Between(-60, 80);
        const launchSpeed = baseSpeed + speedVariation;
        velocityX = totalCount > 1 ? Phaser.Math.Between(-120, 120) : Phaser.Math.Between(-100, 100);
        velocityY = -launchSpeed;
        break;
    }

    return { spawnX, spawnY, velocityX, velocityY };
  }

  // Addictive progression methods
  updateSliceChain(sliceQuality: string): void {
    this.sliceChainProgress++;

    // Apply chain multiplier bonus
    if (sliceQuality === 'perfect') {
      this.sliceChainProgress += 2; // Extra progress for quality slices
    }

    // Level up chain when reaching threshold
    const requiredProgress = this.sliceChainLevel * gameplayConfig.sliceChainBaseProgress.value; // Exponential scaling
    if (this.sliceChainProgress >= requiredProgress) {
      this.sliceChainLevel++;
      this.sliceChainProgress = 0;
      this.showChainLevelUpEffect();
    }
  }

  checkPerfectStreak(): void {
    if (this.currentPerfectStreak > this.perfectSliceStreak) {
      this.perfectSliceStreak = this.currentPerfectStreak;
      this.saveProgress('perfectSliceStreak', this.perfectSliceStreak);
    }

    // Show streak notifications
    if (this.currentPerfectStreak >= gameplayConfig.perfectStreakThreshold.value &&
      this.currentPerfectStreak % gameplayConfig.perfectStreakThreshold.value === 0) {
      this.showPerfectStreakEffect(this.currentPerfectStreak);
      this.playWithVariance(this.perfectStreakSound, 1.0 + (this.currentPerfectStreak * 0.1), 0.02);
    }
  }

  checkOnFireMode(): void {
    this.fireStreakCount++;

    if (this.fireStreakCount >= gameplayConfig.onFireThreshold.value && !this.isOnFire) {
      this.activateOnFireMode();
    }

    // Reset fire streak timer
    this.time.delayedCall(2000, () => {
      if (!this.isOnFire) {
        this.fireStreakCount = 0;
      }
    });
  }

  activateOnFireMode(): void {
    this.isOnFire = true;
    this.playWithVariance(this.onFireModeSound, 1, 0.03);

    // Use the existing frenzy color matrix if available, or create a new one
    if (!this.onFireBrightness) {
      if (this.frenzyColorMatrix) {
        // Reuse the frenzy color matrix for on-fire effect to prevent conflicts
        this.onFireBrightness = this.frenzyColorMatrix;
      } else {
        this.onFireBrightness = this.cameras.main.postFX.addColorMatrix();
      }
    }

    // Apply combined effects: maintain frenzy hue if active, add brightness
    if (this.isFrenzyMode && this.frenzyColorMatrix === this.onFireBrightness) {
      this.onFireBrightness.hue(30).brightness(1.3);
    } else {
      this.onFireBrightness.brightness(1.3);
    }

    this.showOnFireEffect();

    // Deactivate after duration
    this.time.delayedCall(gameplayConfig.onFireDuration.value, () => {
      this.deactivateOnFireMode();
    });
  }

  deactivateOnFireMode(): void {
    this.isOnFire = false;
    this.fireStreakCount = 0;

    // Smoothly remove only the on fire effect instead of clearing all
    if (this.onFireBrightness) {
      this.tweens.addCounter({
        from: 1.3,
        to: 1.0,
        duration: 300,
        onUpdate: (tween) => {
          if (this.onFireBrightness) {
            // If sharing with frenzy mode, maintain the hue while reducing brightness
            if (this.isFrenzyMode && this.frenzyColorMatrix === this.onFireBrightness) {
              this.onFireBrightness.hue(30).brightness(tween.getValue());
            } else {
              this.onFireBrightness.brightness(tween.getValue());
            }
          }
        },
        onComplete: () => {
          if (this.onFireBrightness) {
            // If sharing with frenzy mode, keep the hue and reset brightness
            if (this.isFrenzyMode && this.frenzyColorMatrix === this.onFireBrightness) {
              this.onFireBrightness.hue(30).brightness(1.0);
            } else {
              // Reset the effect to default values
              this.onFireBrightness.brightness(1.0);
              // Only set to null if not shared with frenzy mode
              if (this.frenzyColorMatrix !== this.onFireBrightness) {
                this.onFireBrightness = null;
              }
            }

            // Clear reference if not shared
            if (this.frenzyColorMatrix !== this.onFireBrightness) {
              this.onFireBrightness = null;
            }
          }
        }
      });
    }
  }

  cleanupPostProcessingEffects(): void {
    // Clean up all post-processing effects smoothly to prevent black screen flashes

    // If effects are shared, clean up once
    if (this.frenzyColorMatrix && this.frenzyColorMatrix === this.onFireBrightness) {
      // Shared effect - reset both hue and brightness to default
      this.frenzyColorMatrix.hue(0).brightness(1.0);
      this.frenzyColorMatrix = null;
      this.onFireBrightness = null;
    } else {
      // Separate effects - clean up individually
      if (this.frenzyColorMatrix) {
        this.frenzyColorMatrix.hue(0);
        this.frenzyColorMatrix = null;
      }

      if (this.onFireBrightness) {
        this.onFireBrightness.brightness(1.0);
        this.onFireBrightness = null;
      }
    }

    // Only clear if there are no more custom effects
    this.cameras.main.postFX.clear();
  }

  checkPersonalBest(): void {
    // Only check and show personal best at game end
    if (this.isGameOver && this.score > this.personalBest) {
      this.personalBest = this.score;
      this.saveProgress('personalBest', this.personalBest);
      this.showPersonalBestEffect();
      // Removed horn sound as requested
    }
  }

  detectNearMiss(x: number, y: number): void {
    const missRadius = 80; // Just outside slice radius

    this.fruits.children.entries.forEach(fruit => {
      const fruitSprite = fruit as Phaser.GameObjects.Image;
      if (!fruitSprite.active || (fruitSprite as any).isSliced) return;

      const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
      if (distance < missRadius && distance > 65) { // Between slice radius and miss radius
        this.nearMissCount++;
        this.showNearMissEffect(fruitSprite);
        this.playWithVariance(this.nearMissSound, 0.8, 0.02);
      }
    });
  }

  checkSpectacularSlice(slicedCount: number): void {
    if (slicedCount >= gameplayConfig.spectacularSliceThreshold.value) {
      this.spectacularSlices++;
      this.lastSpectacularTime = this.time.now;
      this.showSpectacularSliceEffect(slicedCount);
      this.playWithVariance(this.spectacularSliceSound, 1.0 + (slicedCount * 0.2), 0.02);

      // Spectacular slices trigger extra score bonus
      const bonusPoints = slicedCount * 50;
      this.score += bonusPoints;
      this.createFloatingScoreText(
        this.scale.gameSize.width / 2,
        this.scale.gameSize.height / 2,
        bonusPoints,
        'spectacular'
      );
    }
  }

  // Visual effect methods
  showStreakNotification(streak: number): void {
    const text = this.add.text(
      this.scale.gameSize.width / 2,
      100,
      `🔥 ${streak} DAY STREAK! 🔥`,
      {
        fontSize: '48px',
        color: '#ff6b35',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6
      }
    ).setOrigin(0.5);

    this.tweens.add({
      targets: text,
      scale: { from: 0, to: 1.2 },
      alpha: { from: 1, to: 0 },
      y: text.y - 50,
      duration: 3000,
      ease: 'Bounce.easeOut',
      onComplete: () => text.destroy()
    });
  }

  showChainLevelUpEffect(): void {
    // Chain level up animations completely removed for clean gameplay experience
  }

  showPerfectStreakEffect(streak: number): void {
    // Perfect streak animations completely removed for clean gameplay experience
  }

  showOnFireEffect(): void {
    if (!PRESENTATION_ONLY) return;
    this.showChip(this.fireChip, "ON FIRE 🔥");
  }

  showPersonalBestEffect(): void {
    // Personal best animations completely removed for clean gameplay experience
  }

  showNearMissEffect(fruit: Phaser.GameObjects.Image): void {
    if (!PRESENTATION_ONLY) return;
    const t = this.getBannerText();
    if (!t) return;
    t.setText("CLOSE!").setStyle({ color: "#ff8080" });
    t.setPosition(fruit.x, fruit.y - 70).setAlpha(0).setScale(0.6).setVisible(true);
    this.tweens.add({
      targets: t,
      alpha: 1,
      duration: 120,
      ease: "Quad.easeOut",
      yoyo: true,
      hold: 60,
      onComplete: () => { (t as any).__free = true; t.setVisible(false); }
    });
  }

  showSpectacularSliceEffect(count: number): void {
    if (!PRESENTATION_ONLY) return;
    this.showComboBanner(`SPECTACULAR x${count}!`);
  }

  update(): void {
    if (this.isGameOver || this.isPaused) return;

    // Check frenzy mode status
    if (this.isFrenzyMode && this.time.now > this.frenzyModeEndTime) {
      this.deactivateFrenzyMode();
    }

    // Check for fruits that fell off screen - simplified logic to ensure consistent life loss
    this.fruits.children.entries.forEach(fruit => {
      const fruitSprite = fruit as Phaser.GameObjects.Image;
      if (!fruitSprite.active) return;

      const fruitData = (fruitSprite as any).fruitData;
      const throwPattern = (fruitSprite as any).throwPattern || 'classic';

      let shouldRemove = false;
      let shouldLoseLife = false;

      // Simplified boundary detection - any fruit that falls below screen should cause life loss
      const fallThreshold = this.scale.gameSize.height + 50;
      const sideThreshold = 250; // How far off sides before removal

      if (fruitSprite.y > fallThreshold) {
        // Fruit fell off bottom of screen
        shouldRemove = true;
        shouldLoseLife = !fruitData.isBomb && !fruitData.isGolden && !(fruitSprite as any).isSliced;
      } else if (fruitSprite.x < -sideThreshold || fruitSprite.x > this.scale.gameSize.width + sideThreshold) {
        // Fruit went too far off sides - remove but no life loss for side throws that never entered play area
        shouldRemove = true;
        // Only lose life if the fruit had a chance to be sliced (entered the main play area)
        if (throwPattern === 'classic' ||
          (fruitSprite.x > this.scale.gameSize.width * 0.1 && fruitSprite.x < this.scale.gameSize.width * 0.9)) {
          shouldLoseLife = !fruitData.isBomb && !fruitData.isGolden && !(fruitSprite as any).isSliced;
        }
      } else if (fruitSprite.y < -600) {
        // Fruit went too high - remove but no life loss
        shouldRemove = true;
      }

      if (shouldRemove) {
        // Don't lose life during golden fruit mode
        if (shouldLoseLife && !this.activeGoldenFruit) {
          this.loseLife();
        }
        fruitSprite.setActive(false);
        fruitSprite.setVisible(false);
      }
    });

    // Clean up inactive fruits
    if (!PRESENTATION_ONLY) {
      // Original per-frame filter (kept for determinism)
      this.fruits.children.entries = this.fruits.children.entries.filter(fruit => fruit.active);
    } else {
      // GC-friendly cadence prune
      if (this.time.now - this.lastPruneTime > this.pruneInterval) {
        const arr = this.fruits.children.entries;
        let w = 0;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].active) arr[w++] = arr[i];
        }
        (arr as any).length = w;
        this.lastPruneTime = this.time.now;
      }
    }

    // Update adaptive music intensity
    this.updateMusicIntensity();
  }

  loseLife(): void {
    this.lives--;
    this.events.emit('livesUpdated', this.lives);

    // Reset slice streak when life is lost
    this.currentSliceStreak = 0;
    this.events.emit('streakUpdated', this.currentSliceStreak);

    if (this.lives <= 0) {
      this.gameOver();
    }
  }

  gameOver(): void {
    this.isGameOver = true;

    // Check for personal best at game end
    this.checkPersonalBest();

    // Add score to leaderboard
    const newRank = utils.addHighScore(this.score);
    const isHighScore = utils.isHighScore(this.score);
    const highScores = utils.getHighScores();

    // Stop all timers
    if (this.fruitSpawnTimer) this.fruitSpawnTimer.destroy();
    if (this.comboTimer) this.comboTimer.destroy();
    if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();

    // Reset time scale
    this.physics.world.timeScale = 1;
    this.time.timeScale = 1;

    // Deactivate any zoom effects
    this.deactivateGoldenFruitZoom();

    // Play game over sound
    this.playWithVariance(this.gameOverSound, 1, 0.02);

    // Launch game over UI
    this.scene.launch("GameOverUIScene", {
      currentLevelKey: this.scene.key,
      finalScore: this.score,
      newRank: newRank,
      isHighScore: isHighScore,
      highScores: highScores
    });
  }

  getDifficultyLevel(): number {
    return Math.floor(this.score / gameplayConfig.difficultyIncreaseInterval.value);
  }

  getDifficultyProgress(): number {
    // Returns 0.0 to 1.0 representing progress within current difficulty level
    const scoreInCurrentLevel = this.score % gameplayConfig.difficultyIncreaseInterval.value;
    return scoreInCurrentLevel / gameplayConfig.difficultyIncreaseInterval.value;
  }

  interpolateDifficulty(minValue: number, maxValue: number, maxDifficultyLevel: number = 10): number {
    const currentLevel = this.getDifficultyLevel();
    const progress = Math.min(currentLevel / maxDifficultyLevel, 1.0);

    // Use smooth easing for more natural progression
    const easedProgress = this.easeInOutQuad(progress);

    return minValue + (maxValue - minValue) * easedProgress;
  }

  easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  getEffectiveDifficultyLevel(): number {
    let effectiveDifficultyLevel = this.getDifficultyLevel();

    // During post-golden-fruit cooldown, temporarily reduce effective difficulty
    if (this.time.now < this.postGoldenFruitCooldown) {
      const cooldownProgress = (this.postGoldenFruitCooldown - this.time.now) / 3000;
      // Temporarily reduce effective difficulty by up to 3 levels during cooldown
      const difficultyReduction = Math.floor(cooldownProgress * 3);
      effectiveDifficultyLevel = Math.max(0, effectiveDifficultyLevel - difficultyReduction);
    }

    return effectiveDifficultyLevel;
  }

  calculateDifficultyValue(currentLevel: number, minValue: number, maxValue: number, maxDifficultyLevel: number = 10): number {
    const progress = Math.min(currentLevel / maxDifficultyLevel, 1.0);

    // Use smooth easing for more natural progression
    const easedProgress = this.easeInOutQuad(progress);

    return minValue + (maxValue - minValue) * easedProgress;
  }

  checkDifficultyProgression(): void {
    const newLevel = this.getDifficultyLevel();

    // Check if we've reached a new difficulty level
    if (newLevel > this.currentDifficultyLevel) {
      this.currentDifficultyLevel = newLevel;

      // Update spawn rate and parameters for new difficulty
      this.updateSpawnRate();

      // Show progression message for every level up to 10
      if (newLevel <= 10) {
        this.events.emit('difficultyIncreased', { level: newLevel });
      }

      // Update last difficulty update score
      this.lastDifficultyUpdateScore = this.score;
    }
    // Also update gradually within the same level for smooth progression
    else if (this.score - this.lastDifficultyUpdateScore >= 50) {
      this.updateSpawnRate();
      this.lastDifficultyUpdateScore = this.score;
    }

    // Update spawn rate if we're in cooldown to ensure smooth transition back
    if (this.time.now < this.postGoldenFruitCooldown) {
      this.updateSpawnRate();
    }
  }

  restart(): void {
    // Stop and cleanup background music to prevent overlapping
    if (this.backgroundMusic) {
      this.backgroundMusic.stop();
      this.backgroundMusic.destroy();
      this.backgroundMusic = undefined as any;
    }

    // Reset game state
    this.lives = gameplayConfig.lives.value;
    this.score = 0;
    this.combo = 0;
    this.isGameOver = false;
    this.activeGoldenFruit = null;
    this.goldenFruitSliceCount = 0;
    this.goldenFruitLastSliceTime = 0;
    this.hasShownDifficultyIncrease = false;
    this.isGoldenFruitZoomed = false;
    this.currentDifficultyLevel = 0;
    this.lastDifficultyUpdateScore = 0;
    this.postGoldenFruitCooldown = 0;

    // Reset enhanced difficulty progression
    this.gameStartTime = this.time.now;
    this.timeBasedDifficultyLevel = 0;
    this.lastTimeBasedIncrease = 0;
    this.rapidFireMode = false;
    this.rapidFireEndTime = 0;
    this.chaosMode = false;
    this.chaosModeEndTime = 0;

    // Reset dopamine features
    this.isFrenzyMode = false;
    this.frenzyModeEndTime = 0;
    this.totalSlices = 0;
    this.perfectSlices = 0;
    this.currentSliceStreak = 0;
    this.maxCombo = 0;
    // Achievement system removed
    this.scoreMultiplier = 1;
    this.lastSliceTime = 0;

    // Clear all objects
    this.fruits.clear(true, true);
    this.sliceTrails.clear(true, true);
    this.particles.clear(true, true);

    // Reset physics
    this.physics.world.timeScale = 1;
    this.time.timeScale = 1;

    // Clean up post-processing effects smoothly
    this.cleanupPostProcessingEffects();

    // Deactivate any zoom effects
    this.deactivateGoldenFruitZoom();

    // Restart spawning
    this.startFruitSpawning();

    // Update UI
    this.events.emit('gameRestarted');
    this.events.emit('scoreUpdated', this.score);
    this.events.emit('livesUpdated', this.lives);
    this.events.emit('comboUpdated', this.combo);
    this.events.emit('streakUpdated', this.currentSliceStreak);
  }

  shutdown(): void {
    // Cleanup background music when scene is stopped/destroyed
    if (this.backgroundMusic) {
      this.backgroundMusic.stop();
      this.backgroundMusic.destroy();
      this.backgroundMusic = undefined as any;
    }

    // Cleanup timers
    if (this.fruitSpawnTimer) {
      this.fruitSpawnTimer.destroy();
    }
    if (this.comboTimer) {
      this.comboTimer.destroy();
    }
    if (this.goldenFruitTimer) {
      this.goldenFruitTimer.destroy();
    }
  }

  // Enhanced Difficulty Progression System
  updateEnhancedDifficulty(): void {
    // Update time-based difficulty
    this.updateTimeBasedDifficulty();

    // Update special mode timers
    this.updateSpecialModes();

    // Trigger special modes based on difficulty
    this.checkSpecialModeActivation();
  }

  updateTimeBasedDifficulty(): void {
    const gameTime = this.time.now - this.gameStartTime;
    const newTimeLevel = Math.floor(gameTime / gameplayConfig.timeBasedDifficultyInterval.value);
    const maxTimeLevel = gameplayConfig.maxTimeBasedDifficulty.value;

    if (newTimeLevel > this.timeBasedDifficultyLevel && newTimeLevel <= maxTimeLevel) {
      this.timeBasedDifficultyLevel = newTimeLevel;
      this.lastTimeBasedIncrease = this.time.now;

      // Show time-based difficulty increase message
      this.events.emit('timeDifficultyIncreased', {
        level: this.timeBasedDifficultyLevel,
        message: `Time Pressure Level ${this.timeBasedDifficultyLevel}!`
      });

      // Update spawn rate to reflect new difficulty
      this.updateSpawnRate();

      console.log(`Time-based difficulty increased to level ${this.timeBasedDifficultyLevel}`);
    }
  }

  updateSpecialModes(): void {
    // Update rapid fire mode
    if (this.rapidFireMode && this.time.now > this.rapidFireEndTime) {
      this.rapidFireMode = false;
      this.updateSpawnRate();
      this.events.emit('rapidFireEnded');
      console.log("Rapid Fire mode ended");
    }

    // Update chaos mode
    if (this.chaosMode && this.time.now > this.chaosModeEndTime) {
      this.chaosMode = false;
      this.updateSpawnRate();
      this.events.emit('chaosModeEnded');
      console.log("Chaos mode ended");
    }
  }

  checkSpecialModeActivation(): void {
    const totalDifficulty = this.getTotalDifficultyLevel();

    // Activate rapid fire mode at higher difficulties
    if (!this.rapidFireMode && !this.chaosMode && totalDifficulty >= 5 && Math.random() < 0.02) {
      this.activateRapidFireMode();
    }

    // Activate chaos mode at very high difficulties
    if (!this.rapidFireMode && !this.chaosMode && totalDifficulty >= 8 && Math.random() < 0.015) {
      this.activateChaosMode();
    }
  }

  activateRapidFireMode(): void {
    this.rapidFireMode = true;
    this.rapidFireEndTime = this.time.now + 10000; // 10 seconds
    this.updateSpawnRate();

    this.events.emit('rapidFireActivated', {
      message: "RAPID FIRE MODE!",
      duration: 10000
    });

    // Visual effect
    this.cameras.main.shake(100, 0.01);

    console.log("Rapid Fire mode activated!");
  }

  activateChaosMode(): void {
    this.chaosMode = true;
    this.chaosModeEndTime = this.time.now + 15000; // 15 seconds
    this.updateSpawnRate();

    this.events.emit('chaosModeActivated', {
      message: "CHAOS MODE!",
      duration: 15000
    });

    // Stronger visual effect
    this.cameras.main.shake(200, 0.02);

    console.log("Chaos mode activated!");
  }

  getTotalDifficultyLevel(): number {
    // Combine score-based and time-based difficulty
    const scoreDifficulty = this.getDifficultyLevel();
    const timeDifficulty = this.timeBasedDifficultyLevel;

    // Use the higher of the two, but add a small bonus for having both
    return Math.max(scoreDifficulty, timeDifficulty) + Math.floor(Math.min(scoreDifficulty, timeDifficulty) / 2);
  }

  createChaosPattern(baseCount: number): void {
    // Create extremely challenging patterns during chaos mode
    const chaosPatterns = ['spiral', 'wave', 'bombardment', 'pincer'];
    const pattern = Phaser.Utils.Array.GetRandom(chaosPatterns);
    const fruitCount = Math.max(baseCount, 5); // At least 5 fruits in chaos mode

    switch (pattern) {
      case 'spiral':
        this.createSpiralPattern(fruitCount);
        break;
      case 'wave':
        this.createWavePattern(fruitCount);
        break;
      case 'bombardment':
        this.createBombardmentPattern(fruitCount);
        break;
      case 'pincer':
        this.createPincerPattern(fruitCount);
        break;
    }
  }

  createRapidFireBurst(): void {
    // Create a rapid succession of single fruits
    const burstCount = Phaser.Math.Between(3, 6);

    for (let i = 0; i < burstCount; i++) {
      this.time.delayedCall(i * 200, () => {
        if (!this.isGameOver) {
          this.createSingleFruit(0, 1, 'fruit');
        }
      });
    }
  }

  createSpiralPattern(count: number): void {
    const angleStep = 360 / count;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 150, () => {
        if (!this.isGameOver) {
          this.createSingleFruit(i, count, undefined, 'spiral');
        }
      });
    }
  }

  createWavePattern(count: number): void {
    // Create fruits in a wave from left to right
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 100, () => {
        if (!this.isGameOver) {
          this.createSingleFruit(i, count, undefined, 'wave');
        }
      });
    }
  }

  createBombardmentPattern(count: number): void {
    // Mix of bombs and fruits in rapid succession
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 120, () => {
        if (!this.isGameOver) {
          const type = Math.random() < 0.3 ? 'bomb' : 'fruit';
          this.createSingleFruit(i, count, type);
        }
      });
    }
  }

  createPincerPattern(count: number): void {
    // Create fruits from both sides simultaneously
    const halfCount = Math.ceil(count / 2);

    for (let i = 0; i < halfCount; i++) {
      this.time.delayedCall(i * 150, () => {
        if (!this.isGameOver) {
          this.createSingleFruit(i, count, undefined, 'left-to-right');
          this.createSingleFruit(i, count, undefined, 'right-to-left');
        }
      });
    }
  }

  createFruitTrail(fruit: Phaser.GameObjects.Image, fruitData: any): void {
    // Fruit trail particles completely removed for clean gameplay experience
  }

  createHourglassSparkles(hourglass: Phaser.GameObjects.Image): void {
    // Hourglass sparkle particles completely removed for clean gameplay experience
  }

  initializeBackgroundMusic(): void {
    // Prevent multiple music instances - stop existing music first
    if (this.backgroundMusic) {
      this.backgroundMusic.stop();
      this.backgroundMusic.destroy();
    }

    // Load saved volume settings
    const musicVolume = parseFloat(localStorage.getItem('sliceSurge_musicVolume') || '0.6');
    const masterVolume = parseFloat(localStorage.getItem('sliceSurge_masterVolume') || '1.0');

    try {
      this.backgroundMusic = this.sound.add("ninja_dojo_music", {
        volume: musicVolume * masterVolume,
        loop: true
      });
      this.backgroundMusic.play();
    } catch (e) {
      console.warn("Background music not found:", e);
    }

    // Initialize intensity values
    this.currentMusicIntensity = 1.0;
    this.targetMusicIntensity = 1.0;
  }

  updateMusicIntensity(): void {
    if (!this.backgroundMusic) return;

    // Calculate target intensity based on game state
    let intensity = 1.0;

    // Base intensity from combo level
    if (this.combo >= 10) {
      intensity = 1.4; // High intensity for big combos
    } else if (this.combo >= 5) {
      intensity = 1.2; // Medium intensity for good combos
    }

    // Boost for special modes
    if (this.isFrenzyMode) {
      intensity *= 1.3; // Extra boost during frenzy
    }

    if (this.isOnFire) {
      intensity *= 1.2; // Boost when on fire
    }

    if (this.chaosMode || this.rapidFireMode) {
      intensity *= 1.25; // Boost for enhanced difficulty
    }

    // Smooth transition to target intensity
    this.targetMusicIntensity = Math.min(intensity, 1.8); // Cap at 1.8x speed

    if (Math.abs(this.currentMusicIntensity - this.targetMusicIntensity) > 0.01) {
      if (this.currentMusicIntensity < this.targetMusicIntensity) {
        this.currentMusicIntensity += this.musicTransitionSpeed;
      } else {
        this.currentMusicIntensity -= this.musicTransitionSpeed;
      }

      // Apply the intensity as playback rate
      (this.backgroundMusic as any).setRate(this.currentMusicIntensity);
    }
  }

  pauseGame(): void {
    this.isPaused = true;

    // Pause background music
    if (this.backgroundMusic && (this.backgroundMusic as any).isPlaying) {
      this.backgroundMusic.pause();
    }

    // Launch pause menu
    this.scene.launch("PauseMenuScene", {
      gameSceneKey: this.scene.key
    });
  }

  resumeGame(): void {
    this.isPaused = false;

    // Resume background music with updated volume settings
    if (this.backgroundMusic) {
      if ((this.backgroundMusic as any).isPaused) {
        this.backgroundMusic.resume();
      } else if (!(this.backgroundMusic as any).isPlaying) {
        // If music stopped completely, restart it
        const musicVolume = parseFloat(localStorage.getItem('sliceSurge_musicVolume') || '0.6');
        const masterVolume = parseFloat(localStorage.getItem('sliceSurge_masterVolume') || '1.0');
        (this.backgroundMusic as any).setVolume(musicVolume * masterVolume);
        this.backgroundMusic.play();
      }
    }
  }
}
