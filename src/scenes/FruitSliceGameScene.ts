/* =========================
   FruitSliceGameScene.ts
   =========================
   Presentation-only polish is fully gated by the toggles below.
   Mechanics, physics, scoring, events, and timing remain unchanged.
*/
const PRESENTATION_ONLY = true;   // When false, visuals fall back to original feel (no extra FX)
const FN_PROFILE        = true;   // Enable Fruit-Ninja style polish preset
const REDUCED_MOTION    = false;  // Accessibility: minimal animations
const HAPTICS           = false;  // navigator.vibrate guarded; never required
const DEV               = false;  // Dev logs / counters only (no runtime effects)

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

  // Soft vignette & parallax layers (pure visuals)
  private vignette?: Phaser.GameObjects.Graphics;
  private parallaxTop?: Phaser.GameObjects.Image;
  private parallaxBottom?: Phaser.GameObjects.Image;
  
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
    { key: "golden_coin", sliceSound: "slice_golden_coin", juiceColor: 0xffd700, points: 30, rarity: 2 }, // Ultra Rare (Highest scoring)
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
  
  // Particle effects (kept for compatibility; may be null when disabled)
  public juiceEmitters: Map<number, Phaser.GameObjects.Particles.ParticleEmitter | null> = new Map();

  // --- lightweight pools for GC-free presentation ---
  private sliceLinePool: Phaser.GameObjects.Line[] = [];
  private sliceLinePoolIndex = 0;
  private popupTextPool: Phaser.GameObjects.Text[] = [];
  private popupTextPoolIndex = 0;

  constructor() {
    super({ key: "FruitSliceGameScene" });
  }

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
    
    if (lastPlayDate === today) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (lastPlayDate === yesterday.toDateString()) {
      this.dailyStreak++;
    } else if (lastPlayDate !== today) {
      this.dailyStreak = 1;
    }
    
    localStorage.setItem('sliceSurge_lastPlayDate', today);
    this.saveProgress('dailyStreak', this.dailyStreak);
    
    if (this.dailyStreak > 1) this.showStreakNotification(this.dailyStreak);
  }

  create(): void {
    if (DEV) console.log("Creating FruitSliceGameScene...");
    
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
    
    // Dopamine features
    this.isFrenzyMode = false;
    this.frenzyModeEndTime = 0;
    this.totalSlices = 0;
    this.perfectSlices = 0;

    this.maxCombo = 0;
    this.scoreMultiplier = 1;
    this.lastSliceTime = 0;
    
    // Addictive progression features
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
    
    // Initialize particle systems (compat map; can be null)
    this.initializeParticles();
    
    // Setup input handlers
    this.setupInputHandlers();

    // Pre-warm tiny pools to reduce spikes (presentation only)
    if (PRESENTATION_ONLY) {
      for (let i = 0; i < 48; i++) this.sliceLinePool.push(this.makeLine(0,0,0,0,0xffffff, 4, true));
      for (let i = 0; i < 12; i++) this.popupTextPool.push(this.makePopupText(-9999,-9999,"", "#fff", 18, true));
    }
    
    // Initialize adaptive background music
    this.initializeBackgroundMusic();
    
    // Start game mechanics
    this.startFruitSpawning();
    
    // Check daily streak and progress
    this.checkDailyStreak();
    
    // Launch UI scene
    this.scene.launch("UIScene", { currentLevelKey: this.scene.key });
    
    // Setup scene events for pause/resume
    this.events.on('resume', () => this.resumeGame());
    
    // Setup scene shutdown event to cleanup music
    this.events.once('shutdown', () => this.shutdown());
    
    // Emit initial UI values
    this.events.emit('streakUpdated', this.currentSliceStreak);
  }

  createBackground(): void {
    // Centered dojo background
    this.background = this.add.image(
      this.scale.gameSize.width / 2, 
      this.scale.gameSize.height / 2, 
      "ninja_dojo_background"
    );
    utils.initScale(this.background, { x: 0.5, y: 0.5 }, this.scale.gameSize.width, this.scale.gameSize.height);
    this.background.setScrollFactor(0);

    // Optional Fruit-Ninja style parallax & vignette (purely visual)
    if (PRESENTATION_ONLY && FN_PROFILE) {
      // Subtle parallax duplicates of background (same key; low alpha)
      this.parallaxTop = this.add.image(this.background.x, this.background.y - 6, "ninja_dojo_background")
        .setAlpha(0.08)
        .setScrollFactor(0)
        .setDepth(-3);
      utils.initScale(this.parallaxTop, { x: 0.5, y: 0.5 }, this.scale.gameSize.width, this.scale.gameSize.height);

      this.parallaxBottom = this.add.image(this.background.x, this.background.y + 6, "ninja_dojo_background")
        .setAlpha(0.08)
        .setScrollFactor(0)
        .setDepth(-3);
      utils.initScale(this.parallaxBottom, { x: 0.5, y: 0.5 }, this.scale.gameSize.width, this.scale.gameSize.height);

      // Soft vignette to focus action center
      this.vignette = this.add.graphics().setDepth(-1);
      this.redrawVignette();
      this.scale.on(Phaser.Scale.Events.RESIZE, () => this.redrawVignette());
    }
  }

  private redrawVignette(): void {
    if (!this.vignette) return;
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    this.vignette.clear();
    const thickness = Math.max(24, Math.floor(Math.min(w,h)*0.025));
    this.vignette.fillStyle(0x000000, 0.18);
    // draw four soft bars
    this.vignette.fillRect(0,0,w,thickness);
    this.vignette.fillRect(0,h-thickness,w,thickness);
    this.vignette.fillRect(0,0,thickness,h);
    this.vignette.fillRect(w-thickness,0,thickness,h);
  }

  initializeSounds(): void {
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
    
    // Dopamine feature sounds (fallbacks safe)
    this.perfectSliceSound = this.safeAddSound("perfect_slice", finalSfxVolume * 1.3, "ui_click");
    this.frenzyModeSound   = this.safeAddSound("frenzy_mode",   finalSfxVolume * 2.0, "ui_click");
    this.spectacularSliceSound = this.safeAddSound("spectacular_slice", finalSfxVolume * 1.7, "ui_click");
    this.onFireModeSound   = this.safeAddSound("on_fire_mode",  finalSfxVolume * 2.0, "ui_click");
    this.perfectStreakSound= this.safeAddSound("perfect_streak",finalSfxVolume * 1.3, "ui_click");
    this.nearMissSound     = this.safeAddSound("near_miss",     finalSfxVolume * 0.7, "ui_click");
    this.personalBestSound = this.safeAddSound("personal_best", finalSfxVolume * 2.3, "ui_click");
    
    // Hourglass hit sounds
    this.hourglassHitSatisfyingSound = this.safeAddSound("hourglass_hit_satisfying", finalSfxVolume * 2.5, "ui_click");
    this.hourglassHitImpactSound     = this.safeAddSound("hourglass_hit_impact",     finalSfxVolume * 2.2, "ui_click");
    this.hourglassHitCascadeSound    = this.safeAddSound("hourglass_hit_cascade",    finalSfxVolume * 2.8, "ui_click");
  }

  private safeAddSound(key: string, volume: number, fallbackKey: string): Phaser.Sound.BaseSound {
    try { return this.sound.add(key, { volume }); }
    catch { return this.sound.add(fallbackKey, { volume }); }
  }

  initializeParticles(): void {
    // Keep map keys for compatibility; allow null emitters when disabled
    this.fruitTypes.forEach(fruitType => {
      this.juiceEmitters.set(fruitType.juiceColor, null);
    });
    // Common colors used elsewhere
    [0xffd700, 0x6A0DAD, 0x00FF00, 0x666666].forEach(col => this.juiceEmitters.set(col, null));
  }

  setupInputHandlers(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isPaused) return;
      this.isSlicing = true;
      this.slicePath = [{ x: pointer.x, y: pointer.y }];
      this.lastSlicePoint = { x: pointer.x, y: pointer.y };
      if (HAPTICS && (navigator as any).vibrate) (navigator as any).vibrate(8);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || this.isPaused || !this.isSlicing) return;
      this.slicePath.push({ x: pointer.x, y: pointer.y });
      this.createSliceTrail(pointer.x, pointer.y);
      this.checkFruitSlice(pointer.x, pointer.y);
      this.lastSlicePoint = { x: pointer.x, y: pointer.y };
    });

    this.input.on('pointerup', () => {
      this.isSlicing = false;
      this.slicePath = [];
      this.lastSlicePoint = undefined;
    });

    const escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey.on('down', () => {
      if (!this.isGameOver && !this.isPaused) this.pauseGame();
    });
  }

  // --- pooled line maker ---
  private makeLine(x1:number,y1:number,x2:number,y2:number,color:number,width:number,hidden=false): Phaser.GameObjects.Line {
    const ln = this.add.line(0,0,x1,y1,x2,y2,color).setLineWidth(width).setDepth(-1);
    if (hidden) { ln.setVisible(false).setActive(false); }
    this.sliceTrails.add(ln);
    return ln;
  }

  private nextLine(): Phaser.GameObjects.Line {
    if (!PRESENTATION_ONLY) return this.makeLine(0,0,0,0,0xffffff, 4, true);
    const ln = this.sliceLinePool[this.sliceLinePoolIndex++ % this.sliceLinePool.length];
    return ln || this.makeLine(0,0,0,0,0xffffff, 4, true);
  }

  // --- pooled popup text maker ---
  private makePopupText(x:number,y:number,text:string,color:string,fontSize:number,hidden=false): Phaser.GameObjects.Text {
    const t = this.add.text(x,y,text,{ fontSize: `${fontSize}px`, color, fontFamily: 'SupercellMagic', stroke: '#000', strokeThickness: 3, align:'center' }).setOrigin(0.5);
    if (hidden) t.setVisible(false).setActive(false);
    return t;
  }

  private nextPopup(): Phaser.GameObjects.Text {
    if (!PRESENTATION_ONLY) return this.makePopupText(-9999,-9999,"", "#fff", 18, true);
    const t = this.popupTextPool[this.popupTextPoolIndex++ % this.popupTextPool.length];
    return t || this.makePopupText(-9999,-9999,"", "#fff", 18, true);
  }

  // --- NEW: rebuild presentation pools after a restart (fix for trails dying) ---
  private rewarmPresentationPools(): void {
    if (!PRESENTATION_ONLY) return;
    // reset indices
    this.sliceLinePoolIndex = 0;
    this.popupTextPoolIndex = 0;
    // drop any old references to destroyed objects
    this.sliceLinePool = [];
    this.popupTextPool = [];
    // ensure groups exist (they do; we just cleared them)
    if (!this.sliceTrails) this.sliceTrails = this.add.group();
    // re-prime pools
    for (let i = 0; i < 48; i++) this.sliceLinePool.push(this.makeLine(0,0,0,0,0xffffff, 4, true));
    for (let i = 0; i < 12; i++) this.popupTextPool.push(this.makePopupText(-9999,-9999,"", "#fff", 18, true));
  }

  createSliceTrail(x: number, y: number): void {
    if (!this.lastSlicePoint) return;

    // Determine trail color based on nearby fruits (visual cue)
    let trailColor = 0xffffff;
    const nearbyFruit = this.findNearbyFruit(x, y);
    if (nearbyFruit) {
      const fruitData = (nearbyFruit as any).fruitData;
      if (fruitData && fruitData.juiceColor) trailColor = fruitData.juiceColor;
    }

    // Presentation-only: butter-smooth short line segment with pooled line
    if (PRESENTATION_ONLY && !REDUCED_MOTION) {
      const ln = this.nextLine();
      ln.setTo(this.lastSlicePoint.x, this.lastSlicePoint.y, x, y);
      ln.setStrokeStyle(6, trailColor, 0.95);
      ln.setBlendMode(Phaser.BlendModes.ADD);
      ln.setVisible(true).setActive(true).setAlpha(0.95).setScale(1,1);

      this.tweens.killTweensOf(ln);
      this.tweens.add({
        targets: ln, alpha: 0, scaleX: 0.6, scaleY: 0.6,
        duration: gameplayConfig.sliceTrailDuration.value, ease: 'Power2',
        onComplete: () => { ln.setVisible(false).setActive(false); }
      });
      return;
    }

    // Fallback minimalist line (keeps original intent)
    const trail = this.add.line(0, 0, this.lastSlicePoint.x, this.lastSlicePoint.y, x, y, trailColor);
    trail.setLineWidth(6).setAlpha(0.9).setDepth(-1);
    this.sliceTrails.add(trail);
    this.tweens.add({
      targets: trail, alpha: 0, scaleX: 0.5, scaleY: 0.5,
      duration: gameplayConfig.sliceTrailDuration.value, ease: 'Power2',
      onComplete: () => trail.destroy()
    });
  }

  findNearbyFruit(x: number, y: number): Phaser.GameObjects.Image | null {
    const searchRadius = 100;
    let closestFruit: Phaser.GameObjects.Image | null = null;
    let closestDistance = searchRadius;
    
    if (this.activeGoldenFruit) {
      const fruitSprite = this.activeGoldenFruit;
      if (fruitSprite.active && !(fruitSprite as any).isSliced) {
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < closestDistance) closestFruit = fruitSprite;
      }
    } else {
      this.fruits.children.entries.forEach(fruit => {
        const fruitSprite = fruit as Phaser.GameObjects.Image;
        if (!fruitSprite.active || (fruitSprite as any).isSliced) return;
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < closestDistance) { closestDistance = distance; closestFruit = fruitSprite; }
      });
    }
    return closestFruit;
  }

  checkFruitSlice(x: number, y: number): void {
    const sliceRadius = 65;
    let slicedCount = 0;
    
    if (this.activeGoldenFruit) {
      const fruitSprite = this.activeGoldenFruit;
      if (fruitSprite.active && !(fruitSprite as any).isSliced) {
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < sliceRadius) { this.sliceFruit(fruitSprite); slicedCount++; }
      }
    } else {
      this.fruits.children.entries.forEach(fruit => {
        const fruitSprite = fruit as Phaser.GameObjects.Image;
        if (!fruitSprite.active || (fruitSprite as any).isSliced) return;
        const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
        if (distance < sliceRadius) { this.sliceFruit(fruitSprite); slicedCount++; }
      });
    }
    
    if (slicedCount > 0) {
      this.handleCombo(slicedCount);
      this.checkSpectacularSlice(slicedCount);
      if (HAPTICS && (navigator as any).vibrate) (navigator as any).vibrate(6);
    } else {
      this.detectNearMiss(x, y);
    }
  }

  sliceFruit(fruit: Phaser.GameObjects.Image): void {
    const fruitData = (fruit as any).fruitData;
    if (fruitData.isBomb) { this.handleBombExplosion(fruit); return; }
    if (fruitData.isGolden) { this.handleGoldenFruitSlice(fruit); return; }
    
    (fruit as any).isSliced = true;
    this.totalSlices++;
    this.totalFruitsSliced++;
    this.lastSliceTime = this.time.now;
    
    this.currentSliceStreak++;
    this.events.emit('streakUpdated', this.currentSliceStreak);
    
    const sliceQuality = this.calculateSliceQuality(fruit);
    let finalMultiplier = this.combo > 1 ? scoreConfig.comboMultiplier.value : 1;
    
    this.updateSliceChain(sliceQuality);
    
    if (sliceQuality === 'perfect') {
      this.perfectSlices++;
      this.currentPerfectStreak++;
      finalMultiplier *= scoreConfig.perfectSliceMultiplier.value;
      this.createPerfectSliceEffect(fruit);
      this.perfectSliceSound?.play();
      this.events.emit('perfectSlice', { x: fruit.x, y: fruit.y });
      this.checkPerfectStreak();
      this.checkOnFireMode();
      if (HAPTICS && (navigator as any).vibrate) (navigator as any).vibrate([10, 8]);
    } else {
      if (this.currentPerfectStreak > 0) this.currentPerfectStreak = 0;
    }
    
    if (this.isFrenzyMode) finalMultiplier *= scoreConfig.frenzyModeMultiplier.value;
    
    const sliceSound = this.fruitSliceSounds.get(fruitData.key);
    if (sliceSound) {
      const pitchMultiplier = sliceQuality === 'perfect' ? 1.15 : 1.0;
      sliceSound.play({ rate: pitchMultiplier });
    }
    
    this.createKaleidoscopeSliceEffect(fruit.x, fruit.y, sliceQuality);
    
    const basePoints = fruitData.points;
    const finalPoints = Math.floor(basePoints * finalMultiplier);
    this.score += finalPoints;
    
    this.createFloatingScoreText(fruit.x, fruit.y, finalPoints, sliceQuality);
    this.checkAndActivateFrenzyMode();
    this.checkDifficultyProgression();
    this.updateEnhancedDifficulty();
    this.saveProgress('totalFruitsSliced', this.totalFruitsSliced);
    this.createSliceEffect(fruit, sliceQuality);
    
    fruit.setActive(false);
    fruit.setVisible(false);
    this.events.emit('scoreUpdated', this.score);
  }

  createKaleidoscopeSliceEffect(x: number, y: number, sliceQuality: string = 'normal'): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION || !FN_PROFILE) return;
    // Minimal, additive burst lines (no physics)
    const count = sliceQuality === 'perfect' ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const len = sliceQuality === 'perfect' ? 140 : 90;
      const sx = x - Math.cos(angle) * len;
      const sy = y - Math.sin(angle) * len;
      const ex = x + Math.cos(angle) * len;
      const ey = y + Math.sin(angle) * len;
      const col = sliceQuality === 'perfect' ? 0xffd700 : 0xffffff;
      const ln = this.makeLine(sx, sy, ex, ey, col, 8);
      ln.setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
      this.tweens.add({ targets: ln, alpha: 0, duration: 260, ease: 'Power2', onComplete: () => ln.destroy() });
    }
  }

  createSliceEffect(fruit: Phaser.GameObjects.Image, sliceQuality: string = 'normal'): void {
    // Two-halves visual only (kept from original logic)
    const leftHalf = this.add.image(fruit.x - 12, fruit.y, fruit.texture.key);
    const rightHalf = this.add.image(fruit.x + 12, fruit.y, fruit.texture.key);
    utils.initScale(leftHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    utils.initScale(rightHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    leftHalf.setCrop(0, 0, leftHalf.width / 2, leftHalf.height);
    rightHalf.setCrop(rightHalf.width / 2, 0, rightHalf.width / 2, rightHalf.height);
    
    const speedMultiplier = sliceQuality === 'perfect' ? 1.2 : 1.0;
    const distance = 120 * speedMultiplier;
    
    this.tweens.add({
      targets: leftHalf, x: leftHalf.x - distance, y: leftHalf.y + 60,
      rotation: -0.5 * speedMultiplier, alpha: 0, duration: 800,
      onComplete: () => leftHalf.destroy()
    });
    this.tweens.add({
      targets: rightHalf, x: rightHalf.x + distance, y: rightHalf.y + 60,
      rotation: 0.5 * speedMultiplier, alpha: 0, duration: 800,
      onComplete: () => rightHalf.destroy()
    });
  }

  calculateSliceQuality(fruit: Phaser.GameObjects.Image): string {
    const timeSinceLastSlice = this.time.now - this.lastSliceTime;
    const perfectTimingWindow = gameplayConfig.perfectSliceWindow.value;
    if (timeSinceLastSlice < perfectTimingWindow || this.isFruitInPerfectZone(fruit)) return 'perfect';
    return 'normal';
  }

  isFruitInPerfectZone(fruit: Phaser.GameObjects.Image): boolean {
    const centerX = this.scale.gameSize.width / 2;
    const centerY = this.scale.gameSize.height / 2;
    const perfectZoneRadius = 200;
    return Phaser.Math.Distance.Between(fruit.x, fruit.y, centerX, centerY) < perfectZoneRadius;
  }

  createPerfectSliceEffect(_fruit: Phaser.GameObjects.Image): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION || !FN_PROFILE) return;
    // Subtle lens pulse via camera color matrix (visual only)
    if (!this.frenzyColorMatrix) this.frenzyColorMatrix = this.cameras.main.postFX.addColorMatrix();
    const fx = this.frenzyColorMatrix!;
    fx.brightness(1.15);
    this.tweens.addCounter({
      from: 1.15, to: 1.0, duration: 220,
      onUpdate: (tw)=>fx.brightness(tw.getValue())
    });
  }

  createFloatingScoreText(x: number, y: number, points: number, quality: string): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const color = quality === 'perfect' ? '#ffd700' : '#ffffff';
    const t = this.nextPopup();
    t.setText(`+${points}`);
    t.setPosition(x, y - 10);
    t.setColor(color);
    t.setVisible(true).setActive(true).setAlpha(1).setScale(1);
    this.tweens.killTweensOf(t);
    this.tweens.add({
      targets: t, y: t.y - 40, alpha: 0, scaleX: 1.15, scaleY: 1.15,
      duration: 600, ease: 'Cubic.easeOut',
      onComplete: () => { t.setVisible(false).setActive(false); }
    });
  }

  triggerScreenShake(intensity: number = 10): void {
    this.cameras.main.shake(100, Math.min(intensity, 6));
  }

  checkAndActivateFrenzyMode(): void {
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.combo >= gameplayConfig.frenzyModeThreshold.value && !this.isFrenzyMode) this.activateFrenzyMode();
  }

  activateFrenzyMode(): void {
    this.isFrenzyMode = true;
    this.frenzyModeEndTime = this.time.now + gameplayConfig.frenzyModeDuration.value;
    this.frenzyModeSound?.play();
    
    if (!this.frenzyColorMatrix) this.frenzyColorMatrix = this.cameras.main.postFX.addColorMatrix();
    if (this.isOnFire && this.onFireBrightness === this.frenzyColorMatrix) {
      this.frenzyColorMatrix.hue(30).brightness(1.3);
    } else {
      this.frenzyColorMatrix.hue(30);
    }
    this.triggerScreenShake(12);
    this.events.emit('frenzyModeActivated', { duration: gameplayConfig.frenzyModeDuration.value });
    this.updateSpawnRate();
  }

  deactivateFrenzyMode(): void {
    this.isFrenzyMode = false;
    if (this.frenzyColorMatrix) {
      this.tweens.addCounter({
        from: 30, to: 0, duration: 300,
        onUpdate: (t)=>{ if (this.frenzyColorMatrix){ if (this.isOnFire && this.onFireBrightness===this.frenzyColorMatrix) this.frenzyColorMatrix.hue(t.getValue()).brightness(1.3); else this.frenzyColorMatrix.hue(t.getValue()); } },
        onComplete: ()=> {
          if (this.frenzyColorMatrix) {
            if (this.isOnFire && this.onFireBrightness===this.frenzyColorMatrix) { this.frenzyColorMatrix.hue(0).brightness(1.3); }
            else { this.frenzyColorMatrix.hue(0); if (this.onFireBrightness !== this.frenzyColorMatrix) this.frenzyColorMatrix = null; }
            if (this.onFireBrightness !== this.frenzyColorMatrix) this.frenzyColorMatrix = null;
          }
        }
      });
    }
    this.events.emit('frenzyModeDeactivated');
    this.updateSpawnRate();
  }

  handleCombo(slicedCount: number): void {
    this.combo += slicedCount;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.comboTimer) this.comboTimer.destroy();
    this.comboTimer = this.time.delayedCall(gameplayConfig.comboTimeWindow.value, () => {
      this.combo = 0;
      this.events.emit('comboUpdated', this.combo);
    });
    if (this.combo >= 5) this.createComboText(this.combo);
    this.events.emit('comboUpdated', this.combo);
  }

  createComboText(comboCount: number): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText(`${comboCount}x COMBO`);
    t.setPosition(this.scale.gameSize.width/2, 120);
    t.setColor('#00ffea');
    t.setVisible(true).setActive(true).setAlpha(0).setScale(0.8);
    this.tweens.killTweensOf(t);
    this.tweens.add({ targets:t, alpha:1, scaleX:1.1, scaleY:1.1, duration:220, ease:'Back.Out' });
    this.tweens.add({ delay:620, targets:t, alpha:0, duration:250, onComplete:()=>t.setVisible(false).setActive(false) });
  }

  selectWeightedFruit(): FruitType {
    const totalWeight = this.fruitTypes.reduce((sum, fruit) => sum + fruit.rarity, 0);
    const random = Math.random() * totalWeight;
    let currentWeight = 0;
    for (const fruit of this.fruitTypes) {
      currentWeight += fruit.rarity;
      if (random <= currentWeight) return fruit;
    }
    return Phaser.Utils.Array.GetRandom(this.fruitTypes);
  }

  playHourglassHitSound(sliceCount: number): void {
    if (sliceCount <= 5) this.hourglassHitSatisfyingSound?.play();
    else if (sliceCount <= 15) (sliceCount % 2 === 0 ? this.hourglassHitImpactSound : this.hourglassHitSatisfyingSound)?.play();
    else this.hourglassHitCascadeSound?.play();
  }

  handleGoldenFruitSlice(goldenFruit: Phaser.GameObjects.Image): void {
    const currentTime = this.time.now;
    const isFirstSlice = this.activeGoldenFruit !== goldenFruit;
    if (isFirstSlice) this.initializeGoldenFruit(goldenFruit);
    
    const hitZone = this.checkHourglassPrecisionZone(goldenFruit);
    if (!hitZone) { this.handleHourglassMiss(); return; }
    
    this.goldenFruitSliceCount++;
    this.goldenFruitLastSliceTime = currentTime;
    
    this.playHourglassHitSound(this.goldenFruitSliceCount);
    this.currentSliceStreak++;
    this.events.emit('streakUpdated', this.currentSliceStreak);
    
    const points = this.calculateHourglassPoints(this.goldenFruitSliceCount);
    this.score += points;
    
    this.createMinimalGoldenSliceEffect(goldenFruit, this.goldenFruitSliceCount);
    
    const newPhase = Math.min(6, Math.floor(this.goldenFruitSliceCount / 2));
    const currentPhase = (this.activeGoldenFruit as any).currentMovementPhase || 0;
    if (newPhase > currentPhase) {
      (this.activeGoldenFruit as any).currentMovementPhase = newPhase;
      this.startHourglassMovementPhase(this.activeGoldenFruit, newPhase);
    }
    
    if (this.goldenFruitSliceCount >= gameplayConfig.goldenFruitMaxSlices.value) {
      this.finalizeGoldenFruit();
    } else {
      if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();
      const currentSliceWindow = Math.max(100, gameplayConfig.goldenFruitSliceWindow.value - (this.goldenFruitSliceCount - 1) * 50);
      this.goldenFruitTimer = this.time.delayedCall(currentSliceWindow, () => this.finalizeGoldenFruit());
    }
    
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
    
    this.handleOtherFruitsForGoldenMode();
    this.pauseFruitSpawning();
    
    const body = goldenFruit.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.setVelocity(0, 0);
      body.setGravityY(0);
      const floatX = this.scale.gameSize.width / 2;
      const floatY = this.scale.gameSize.height / 2 - 50;
      goldenFruit.setPosition(floatX, floatY);
      goldenFruit.setDepth(50);
      (goldenFruit as any).initialX = floatX;
      (goldenFruit as any).initialY = floatY;
      (goldenFruit as any).currentMovementPhase = 0;
      this.startHourglassMovementPhase(goldenFruit, 0);
    }
    
    this.activateGoldenFruitZoom(goldenFruit);
    this.addGoldenGlowEffect(goldenFruit);
    
    if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();
    this.goldenFruitTimer = this.time.delayedCall(gameplayConfig.goldenFruitHoverDuration.value, () => this.finalizeGoldenFruit());
  }

  handleOtherFruitsForGoldenMode(): void {
    let autoSlicedCount = 0;
    let bombsRemoved = 0;
    
    this.fruits.children.entries.forEach(f => {
      const fruitSprite = f as Phaser.GameObjects.Image;
      if (!fruitSprite.active || fruitSprite === this.activeGoldenFruit) return;
      const fruitData = (fruitSprite as any).fruitData;
      if (!fruitData.isBomb && !fruitData.isGolden) {
        this.autoSliceRegularFruit(fruitSprite);
        autoSlicedCount++;
      } else if (fruitData.isBomb) {
        this.removeBombSafely(fruitSprite);
        bombsRemoved++;
      }
    });
    if (autoSlicedCount > 0 || bombsRemoved > 0) this.showAutoSliceNotification(autoSlicedCount, bombsRemoved);
  }

  autoSliceRegularFruit(fruit: Phaser.GameObjects.Image): void {
    (fruit as any).isSliced = true;
    const fruitData = (fruit as any).fruitData;
    this.createAutoSliceEffect(fruit);
    const emitter = this.juiceEmitters.get(fruitData.juiceColor);
    if (emitter) { emitter.setPosition(fruit.x, fruit.y); emitter.explode(5); }
    fruit.setActive(false); fruit.setVisible(false);
  }

  createAutoSliceEffect(fruit: Phaser.GameObjects.Image): void {
    const leftHalf = this.add.image(fruit.x - 8, fruit.y, fruit.texture.key);
    const rightHalf = this.add.image(fruit.x + 8, fruit.y, fruit.texture.key);
    utils.initScale(leftHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    utils.initScale(rightHalf, { x: 0.5, y: 0.5 }, undefined, gameplayConfig.fruitSize.value);
    leftHalf.setAlpha(0.6); rightHalf.setAlpha(0.6);
    leftHalf.setCrop(0, 0, leftHalf.width / 2, leftHalf.height);
    rightHalf.setCrop(rightHalf.width / 2, 0, rightHalf.width / 2, rightHalf.height);
    this.tweens.add({ targets: leftHalf, x: leftHalf.x - 60, y: leftHalf.y + 30, rotation: -0.3, alpha: 0, duration: 600, onComplete: () => leftHalf.destroy() });
    this.tweens.add({ targets: rightHalf, x: rightHalf.x + 60, y: rightHalf.y + 30, rotation: 0.3,  alpha: 0, duration: 600, onComplete: () => rightHalf.destroy() });
  }

  removeBombSafely(bomb: Phaser.GameObjects.Image): void {
    bomb.setActive(false); bomb.setVisible(false);
    const emitter = this.juiceEmitters.get(0x666666);
    if (emitter) { emitter.setPosition(bomb.x, bomb.y); emitter.explode(3); }
  }

  pauseFruitSpawning(): void { if (this.fruitSpawnTimer) this.fruitSpawnTimer.paused = true; }
  resumeFruitSpawning(): void {
    if (this.fruitSpawnTimer) this.fruitSpawnTimer.paused = false;
    this.fruits.children.entries.forEach(f => {
      const fruitSprite = f as Phaser.GameObjects.Image;
      if (fruitSprite.active && fruitSprite.body) {
        const body = fruitSprite.body as Phaser.Physics.Arcade.Body;
        const fruitData = (fruitSprite as any).fruitData;
        if (!fruitData || !fruitData.isGolden) {
          if (Math.abs(body.gravity.y) < 100) body.setGravityY(gameplayConfig.fruitGravity.value);
        }
      }
    });
  }

  showAutoSliceNotification(autoSlicedCount: number, bombsRemoved: number): void {
    let message = "";
    if (autoSlicedCount > 0 && bombsRemoved > 0) message = `${autoSlicedCount} FRUITS AUTO-SLICED • ${bombsRemoved} BOMBS CLEARED`;
    else if (autoSlicedCount > 0) message = `${autoSlicedCount} FRUITS AUTO-SLICED`;
    else if (bombsRemoved > 0) message = `${bombsRemoved} BOMBS CLEARED`;
    if (!message || !PRESENTATION_ONLY || REDUCED_MOTION) return;

    const notificationText = this.add.text(this.scale.gameSize.width/2, this.scale.gameSize.height/2 + 150, message, {
      fontSize: '24px', color: '#ffff00', fontFamily: 'SupercellMagic', stroke: '#000000', strokeThickness: 3, align: 'center'
    }).setOrigin(0.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: notificationText, alpha: 1, y: notificationText.y - 30, duration: 300, ease: 'Power2' });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: notificationText, alpha: 0, y: notificationText.y - 20, duration: 300, ease: 'Power2', onComplete: () => notificationText.destroy() });
    });
  }

  activateGoldenFruitZoom(goldenFruit: Phaser.GameObjects.Image): void {
    if (this.isGoldenFruitZoomed) return;
    this.isGoldenFruitZoomed = true;
    
    const zoomLevel = 1.8;
    const targetX = goldenFruit.x;
    const targetY = goldenFruit.y;
    
    const overlay = this.add.rectangle(this.scale.gameSize.width/2, this.scale.gameSize.height/2, this.scale.gameSize.width, this.scale.gameSize.height, 0x000000, 0);
    overlay.setDepth(10);
    this.tweens.add({ targets: overlay, alpha: 0.4, duration: 300, ease: 'Power2' });
    (this as any).goldenFruitOverlay = overlay;
    
    this.tweens.add({ targets: this.cameras.main, zoom: zoomLevel, duration: 500, ease: 'Power2' });
    this.cameras.main.stopFollow();
    this.cameras.main.startFollow(goldenFruit, true, 0.1, 0.1);
    this.tweens.add({ targets: this.cameras.main, scrollX: targetX - this.scale.gameSize.width/2, scrollY: targetY - this.scale.gameSize.height/2, duration: 500, ease: 'Power2' });
    
    const edgeGlow = this.add.graphics().setDepth(15);
    edgeGlow.lineStyle(10, 0xffd700, 0.3);
    edgeGlow.strokeRect(10, 10, this.scale.gameSize.width - 20, this.scale.gameSize.height - 20);
    edgeGlow.setAlpha(0);
    this.tweens.add({ targets: edgeGlow, alpha: 0.4, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    (this as any).goldenFruitEdgeGlow = edgeGlow;
    
    this.events.emit('goldenFruitZoomActivated');
  }

  deactivateGoldenFruitZoom(): void {
    if (!this.isGoldenFruitZoomed) return;
    this.isGoldenFruitZoomed = false;
    
    const overlay = (this as any).goldenFruitOverlay;
    if (overlay) { this.tweens.add({ targets: overlay, alpha: 0, duration: 500, ease: 'Power2', onComplete: () => overlay.destroy() }); (this as any).goldenFruitOverlay = null; }
    const edgeGlow = (this as any).goldenFruitEdgeGlow;
    if (edgeGlow) { this.tweens.add({ targets: edgeGlow, alpha: 0, duration: 300, ease: 'Power2', onComplete: () => edgeGlow.destroy() }); (this as any).goldenFruitEdgeGlow = null; }
    
    this.time.delayedCall(500, () => {
      this.cameras.main.stopFollow();
      this.tweens.add({ targets: this.cameras.main, zoom: 1, duration: 1000, ease: 'Power2' });
      this.tweens.add({ targets: this.cameras.main, scrollX: 0, scrollY: 0, duration: 1000, ease: 'Power2', onComplete: () => this.cameras.main.centerOn(this.scale.gameSize.width/2, this.scale.gameSize.height/2) });
    });
    
    this.events.emit('goldenFruitZoomDeactivated');
  }

  addGoldenGlowEffect(goldenFruit: Phaser.GameObjects.Image): void {
    // minimal tint pulse
    goldenFruit.setTint(0xffff88);
    this.tweens.add({ targets: goldenFruit, scaleX: goldenFruit.scaleX * 1.1, scaleY: goldenFruit.scaleY * 1.1, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  createGoldenSliceEffect(_goldenFruit: Phaser.GameObjects.Image, _sliceNumber: number, _points: number): void {
    // kept compact; we already have minimal slice feedback elsewhere
  }

  finalizeGoldenFruit(): void {
    if (!this.activeGoldenFruit) return;
    this.createFinalGoldenExplosion(this.activeGoldenFruit);
    this.time.delayedCall(1500, () => {
      this.deactivateGoldenFruitZoom();
      this.postGoldenFruitCooldown = this.time.now + 3000;
      this.resumeFruitSpawning();
      if (this.activeGoldenFruit) {
        const body = this.activeGoldenFruit.body as Phaser.Physics.Arcade.Body;
        if (body) body.setGravityY(gameplayConfig.fruitGravity.value);
        this.activeGoldenFruit.setActive(false).setVisible(false);
      }
      this.activeGoldenFruit = null;
      this.goldenFruitSliceCount = 0;
      this.goldenFruitLastSliceTime = 0;
      if (this.goldenFruitTimer) { this.goldenFruitTimer.destroy(); this.goldenFruitTimer = undefined; }
    });
  }

  createFinalGoldenExplosion(goldenFruit: Phaser.GameObjects.Image): void {
    const centerX = goldenFruit.x, centerY = goldenFruit.y;
    const colors = [0x6A0DAD, 0xFFD700, 0x00FF00];
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI * 2) / 16;
      const length = 300 + Math.random() * 100;
      const currentColor = colors[i % colors.length];
      const explosionLine = this.add.line(0, 0, centerX, centerY, centerX + Math.cos(angle)*length, centerY + Math.sin(angle)*length, currentColor)
        .setLineWidth(15 + Math.random() * 10)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(5)
        .setAlpha(1);
      this.tweens.add({ targets: explosionLine, alpha: 0, scaleX: 0.1, scaleY: 0.1, duration: 1200 + Math.random()*400, ease:'Power2', onComplete: () => explosionLine.destroy() });
    }
    for (let ring = 0; ring < 3; ring++) {
      const delayTime = ring * 200;
      const ringColor = colors[ring % colors.length];
      this.time.delayedCall(delayTime, () => {
        const ringGraphics = this.add.graphics().setDepth(5);
        ringGraphics.lineStyle(8, ringColor, 0.8).strokeCircle(centerX, centerY, 50).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ringGraphics, scaleX: 8, scaleY: 8, alpha: 0, duration: 1000, ease:'Power2', onComplete: () => ringGraphics.destroy() });
      });
    }
    this.cameras.main.shake(300, 0.015);
    const finalFlash = this.add.rectangle(this.scale.gameSize.width/2, this.scale.gameSize.height/2, this.scale.gameSize.width, this.scale.gameSize.height, 0xFFD700, 0.2).setDepth(20);
    this.tweens.add({ targets: finalFlash, alpha: 0, duration: 1000, ease: 'Power2', onComplete: () => finalFlash.destroy() });
  }

  createScorePopup(_x: number, _y: number, _text: string, _color: number, _scale: number = 1): void {
    // Popups handled by createFloatingScoreText in this build
  }

  handleHourglassMiss(): void {
    if (this.goldenFruitSliceCount > 0) this.goldenFruitSliceCount = Math.max(0, this.goldenFruitSliceCount - 2);
    this.createHourglassMissEffect();
    if (this.goldenFruitSliceCount <= 0) { this.finalizeGoldenFruit(); return; }
    if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();
    const currentSliceWindow = Math.max(100, gameplayConfig.goldenFruitSliceWindow.value - (this.goldenFruitSliceCount - 1) * 50);
    this.goldenFruitTimer = this.time.delayedCall(currentSliceWindow, () => this.finalizeGoldenFruit());
    this.events.emit('goldenFruitSlice', { slice: this.goldenFruitSliceCount, points: 0, totalSlices: gameplayConfig.goldenFruitMaxSlices.value, missed: true });
  }

  checkHourglassPrecisionZone(goldenFruit: Phaser.GameObjects.Image): boolean {
    const pointer = this.input.activePointer;
    const distance = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, goldenFruit.x, goldenFruit.y);
    const hitRadius = 80;
    return distance <= hitRadius;
  }

  startHourglassMovementPhase(goldenFruit: Phaser.GameObjects.Image, phase: number): void {
    this.tweens.killTweensOf(goldenFruit);
    const initialX = (goldenFruit as any).initialX;
    const initialY = (goldenFruit as any).initialY;
    switch (phase) {
      case 0:
        this.tweens.add({ targets: goldenFruit, y: initialY - 15, duration: 1500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 }); break;
      case 1:
        this.tweens.add({ targets: goldenFruit, x: initialX - 60, y: initialY - 20, duration: 800, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 }); break;
      case 2: this.createRapidZigzag(goldenFruit, initialX, initialY); break;
      case 3: this.createChaosEight(goldenFruit, initialX, initialY); break;
      case 4: this.createErraticBurst(goldenFruit, initialX, initialY); break;
      case 5: this.createSpeedDemon(goldenFruit, initialX, initialY); break;
      case 6: this.createNightmareMovement(goldenFruit, initialX, initialY); break;
    }
  }

  createRapidZigzag(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const zigzag = () => {
      const targetX = initialX + (Math.random() - 0.5) * 80;
      const targetY = initialY + (Math.random() - 0.5) * 50;
      this.tweens.add({ targets: goldenFruit, x: targetX, y: targetY, duration: 300 + Math.random()*200, ease: 'Power1', onComplete: zigzag });
    }; zigzag();
  }

  createChaosEight(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    let startTime = this.time.now;
    this.tweens.add({ targets: goldenFruit, duration: 50, repeat: -1, onUpdate: () => {
      const t = (this.time.now - startTime) * 0.006;
      goldenFruit.x = initialX + 70 * Math.cos(t);
      goldenFruit.y = initialY + 40 * Math.sin(t * 2);
    }});
  }

  createErraticBurst(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const burst = () => {
      const targetX = initialX + (Math.random() - 0.5) * 100;
      const targetY = initialY + (Math.random() - 0.5) * 70;
      this.tweens.add({ targets: goldenFruit, x: targetX, y: targetY, duration: 150 + Math.random()*150, ease: 'Power2', onComplete: burst });
    }; burst();
  }

  createSpeedDemon(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const speedMove = () => {
      const targetX = initialX + (Math.random() - 0.5) * 120;
      const targetY = initialY + (Math.random() - 0.5) * 80;
      this.tweens.add({ targets: goldenFruit, x: targetX, y: targetY, duration: 100 + Math.random()*100, ease: 'Power3', onComplete: speedMove });
    }; speedMove();
  }

  createNightmareMovement(goldenFruit: Phaser.GameObjects.Image, initialX: number, initialY: number): void {
    const nightmare = () => {
      const targetX = initialX + (Math.random() - 0.5) * 140;
      const targetY = initialY + (Math.random() - 0.5) * 90;
      this.tweens.add({ targets: goldenFruit, x: targetX, y: targetY, duration: 80 + Math.random()*80, ease: 'Power4', onComplete: nightmare });
    }; nightmare();
  }

  calculateHourglassPoints(sliceNumber: number): number {
    if (sliceNumber >= 1 && sliceNumber <= 20) return 25;
    return 0;
  }

  getTotalHourglassPossiblePoints(maxSlices: number): number {
    let total = 0;
    for (let i = 1; i <= Math.min(maxSlices, 20); i++) total += this.calculateHourglassPoints(i);
    return total;
  }

  createMinimalGoldenSliceEffect(goldenFruit: Phaser.GameObjects.Image, sliceNumber: number): void {
    const centerX = goldenFruit.x, centerY = goldenFruit.y;
    const colors = [0x6A0DAD, 0xFFD700, 0x00FF00];
    const currentColor = colors[sliceNumber % colors.length];
    const angle = Math.random() * Math.PI * 2;
    const length = 80;
    const sliceLine = this.add.line(0, 0, centerX - Math.cos(angle)*length, centerY - Math.sin(angle)*length, centerX + Math.cos(angle)*length, centerY + Math.sin(angle)*length, currentColor)
      .setLineWidth(6).setAlpha(0.8).setDepth(5);
    this.tweens.add({ targets: sliceLine, alpha: 0, duration: 200, ease: 'Power2', onComplete: () => sliceLine.destroy() });
    const emitter = this.juiceEmitters.get(currentColor);
    if (emitter) { emitter.setPosition(centerX, centerY); emitter.explode(5); }
  }

  createHourglassMissEffect(): void {
    if (!this.activeGoldenFruit) return;
    const centerX = this.activeGoldenFruit.x, centerY = this.activeGoldenFruit.y;
    const missFlash = this.add.rectangle(this.scale.gameSize.width/2, this.scale.gameSize.height/2, this.scale.gameSize.width, this.scale.gameSize.height, 0xFF0000, 0.3).setDepth(5);
    this.tweens.add({ targets: missFlash, alpha: 0, duration: 200, onComplete: () => missFlash.destroy() });
    const missText = this.add.text(centerX, centerY - 80, 'MISS!', { fontSize: '36px', color: '#FF0000', fontFamily: 'SupercellMagic', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setDepth(100);
    this.tweens.add({ targets: missText, scaleX: 1.5, scaleY: 1.5, alpha: 0, y: centerY - 120, duration: 800, ease: 'Power2', onComplete: () => missText.destroy() });
    this.cameras.main.shake(200, 0.02);
  }

  handleBombExplosion(bomb: Phaser.GameObjects.Image): void {
    this.bombExplosionSound?.play();
    const flash = this.add.rectangle(this.scale.gameSize.width/2, this.scale.gameSize.height/2, this.scale.gameSize.width, this.scale.gameSize.height, 0xffffff, 0.8).setDepth(1000);
    this.tweens.add({ targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
    for (let i = 0; i < 3; i++) {
      const c = this.add.circle(bomb.x, bomb.y, 40 + (i * 20), i === 0 ? 0xff0000 : 0xff4444, 0.6 - (i * 0.15));
      this.tweens.add({ targets: c, scaleX: 4 + (i*0.5), scaleY: 4 + (i*0.5), alpha: 0, duration: 600 + (i*100), delay: i * 50, onComplete: () => c.destroy() });
    }
    this.cameras.main.shake(400, 15);
    bomb.setActive(false); bomb.setVisible(false);
    if (HAPTICS && (navigator as any).vibrate) (navigator as any).vibrate([10, 15, 10]);
    this.gameOver();
  }

  startFruitSpawning(): void { this.updateSpawnRate(); }

  updateSpawnRate(): void {
    if (this.fruitSpawnTimer) this.fruitSpawnTimer.destroy();
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();
    let spawnRate = this.calculateDifficultyValue(effectiveDifficultyLevel, gameplayConfig.minSpawnRate.value, gameplayConfig.maxSpawnRate.value, 8);
    if (this.isFrenzyMode) spawnRate *= 0.6;
    if (this.rapidFireMode) spawnRate *= 0.4;
    if (this.chaosMode) spawnRate *= 0.3;
    this.fruitSpawnTimer = this.time.addEvent({ delay: spawnRate, callback: this.spawnFruit, callbackScope: this, loop: true });
  }

  spawnFruit(): void {
    if (this.isGameOver || this.isPaused) return;
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();
    let multiFruitChance = this.calculateDifficultyValue(effectiveDifficultyLevel, gameplayConfig.minMultiFruitChance.value, gameplayConfig.maxMultiFruitChance.value, 6);
    const maxFruits = Math.min(2 + Math.floor(effectiveDifficultyLevel / 2), gameplayConfig.maxMultiFruitCount.value);
    const shouldSpawnMultiple = Math.random() < multiFruitChance;
    const spawnCount = shouldSpawnMultiple ? Phaser.Math.Between(2, maxFruits) : 1;
    
    if (this.chaosMode && Math.random() < gameplayConfig.chaosSpawnChance.value) {
      this.createChaosPattern(spawnCount);
    } else if (this.rapidFireMode && Math.random() < gameplayConfig.rapidFireChance.value) {
      this.createRapidFireBurst();
    } else if (effectiveDifficultyLevel >= 6 && spawnCount > 1 && Math.random() < gameplayConfig.challengingPatternChance.value) {
      this.createChallengingPattern(spawnCount);
    } else {
      for (let i = 0; i < spawnCount; i++) this.createSingleFruit(i, spawnCount);
    }
  }

  createChallengingPattern(spawnCount: number): void {
    const patterns = ['bomb-sandwich', 'criss-cross-bombs', 'bomb-flanks'];
    const chosenPattern = Phaser.Utils.Array.GetRandom(patterns);
    switch (chosenPattern) {
      case 'bomb-sandwich':
        for (let i = 0; i < spawnCount; i++) this.createSingleFruit(i, spawnCount, i === Math.floor(spawnCount / 2) ? 'bomb' : 'fruit');
        break;
      case 'criss-cross-bombs':
        for (let i = 0; i < spawnCount; i++) {
          const forceBomb = i % 2 === 0 && Math.random() < 0.4;
          this.createSingleFruit(i, spawnCount, forceBomb ? 'bomb' : 'fruit', 'criss-cross');
        }
        break;
      case 'bomb-flanks':
        for (let i = 0; i < spawnCount; i++) {
          const forceBomb = (i === 0 || i === spawnCount - 1) && Math.random() < 0.5;
          this.createSingleFruit(i, spawnCount, forceBomb ? 'bomb' : 'fruit');
        }
        break;
    }
  }

  createSingleFruit(index: number, totalCount: number, forceType?: string, forcePattern?: string): void {
    let spawnKey: string;
    let fruitData: any;
    const effectiveDifficultyLevel = this.getEffectiveDifficultyLevel();
    const bombChance = this.calculateDifficultyValue(effectiveDifficultyLevel, gameplayConfig.minBombChance.value, gameplayConfig.maxBombChance.value, 6);
    const random = Math.random();

    if (forceType === 'bomb') {
      spawnKey = "bomb_object";
      fruitData = { key: spawnKey, isBomb: true, isGolden: false, juiceColor: 0x000000, points: 0 };
    } else if (forceType === 'fruit') {
      const fruitType = this.selectWeightedFruit();
      spawnKey = fruitType.key;
      fruitData = { key: spawnKey, isBomb: false, isGolden: false, juiceColor: fruitType.juiceColor, points: fruitType.points };
    } else {
      if (random < bombChance) {
        spawnKey = "bomb_object";
        fruitData = { key: spawnKey, isBomb: true, isGolden: false, juiceColor: 0x000000, points: 0 };
      } else if (random < bombChance + gameplayConfig.goldenFruitChance.value) {
        spawnKey = "golden_fruit_powerup";
        fruitData = { key: spawnKey, isBomb: false, isGolden: true, juiceColor: 0xffd700, points: scoreConfig.goldenFruitPoints.value };
      } else {
        const fruitType = this.selectWeightedFruit();
        spawnKey = fruitType.key;
        fruitData = { key: spawnKey, isBomb: false, isGolden: false, juiceColor: fruitType.juiceColor, points: fruitType.points };
      }
    }
    
    const throwPattern = forcePattern || this.getThrowingPattern(effectiveDifficultyLevel, totalCount, index);
    const trajectory = this.calculateThrowTrajectory(throwPattern, index, totalCount);
    const fruit = this.add.image(trajectory.spawnX, trajectory.spawnY, spawnKey);
    fruit.setDepth(0);
    const fruitSize = fruitData.isGolden ? gameplayConfig.fruitSize.value * 1.5 : gameplayConfig.fruitSize.value;
    utils.initScale(fruit, { x: 0.5, y: 0.5 }, undefined, fruitSize);

    this.physics.add.existing(fruit);
    const body = fruit.body as Phaser.Physics.Arcade.Body;

    const totalDifficultyLevel = this.getTotalDifficultyLevel();
    const rawSpeedMultiplier = 1 + (totalDifficultyLevel * gameplayConfig.fruitSpeedIncrease.value);
    const speedMultiplier = Math.min(rawSpeedMultiplier, 1.3);
    const gravityMultiplier = 1 + (totalDifficultyLevel * gameplayConfig.gravityIncrease.value);
    
    let finalVelocityX = trajectory.velocityX;
    let finalVelocityY = trajectory.velocityY;
    const hasSpeedBoost = Math.random() < gameplayConfig.speedBoostChance.value && totalDifficultyLevel >= 3;
    if (hasSpeedBoost) {
      fruitData.hasSpeedBoost = true;
      const extraSpeed = 1.25;
      finalVelocityX *= extraSpeed;
      finalVelocityY *= extraSpeed;
    }
    
    body.setVelocity(finalVelocityX * speedMultiplier, finalVelocityY * speedMultiplier);
    if (fruitData.isGolden && this.activeGoldenFruit === fruit) body.setGravityY(0);
    else body.setGravityY(gameplayConfig.fruitGravity.value * gravityMultiplier);
    
    (fruit as any).fruitData = fruitData;
    (fruit as any).isSliced = false;
    (fruit as any).throwPattern = throwPattern;
    this.fruits.add(fruit);

    const rotationSpeed = throwPattern === 'criss-cross' ? 1800 + Phaser.Math.Between(-600, 600) : 1800 + Phaser.Math.Between(-400, 400);
    this.tweens.add({ targets: fruit, angle: 360, duration: rotationSpeed, repeat: -1 });

    this.createFruitTrail(fruit, fruitData);
    if (fruitData.isGolden) this.createHourglassSparkles(fruit);
  }

  getThrowingPattern(difficultyLevel: number, totalCount: number, index: number): string {
    const patterns = ['classic', 'left-to-right', 'right-to-left', 'criss-cross', 'side-throw'];
    if (difficultyLevel < gameplayConfig.sideThrowStartLevel.value) return Phaser.Utils.Array.GetRandom(['classic', 'classic', 'left-to-right']);
    if (difficultyLevel < gameplayConfig.crissTrajectoryStartLevel.value) return Phaser.Utils.Array.GetRandom(['classic', 'left-to-right', 'right-to-left', 'side-throw']);
    if (difficultyLevel >= gameplayConfig.maxChaosLevel.value) {
      if (totalCount > 1) return Phaser.Utils.Array.GetRandom(['criss-cross', 'criss-cross', 'side-throw', 'left-to-right', 'right-to-left']);
    }
    const availablePatterns = ['classic'];
    if (difficultyLevel >= gameplayConfig.sideThrowStartLevel.value) availablePatterns.push('left-to-right', 'right-to-left', 'side-throw');
    if (difficultyLevel >= gameplayConfig.crissTrajectoryStartLevel.value) availablePatterns.push('criss-cross');
    return Phaser.Utils.Array.GetRandom(availablePatterns);
  }

  calculateThrowTrajectory(pattern: string, index: number, totalCount: number): { spawnX: number, spawnY: number, velocityX: number, velocityY: number } {
    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;
    const baseSpeed = gameplayConfig.fruitLaunchSpeed.value;
    let spawnX: number, spawnY: number, velocityX: number, velocityY: number;
    switch (pattern) {
      case 'left-to-right':
        spawnX = -50; spawnY = screenHeight * 0.7 + Phaser.Math.Between(-50, 50);
        velocityX = Phaser.Math.Between(280, 400); velocityY = Phaser.Math.Between(-550, -420);
        break;
      case 'right-to-left':
        spawnX = screenWidth + 50; spawnY = screenHeight * 0.7 + Phaser.Math.Between(-50, 50);
        velocityX = Phaser.Math.Between(-400, -280); velocityY = Phaser.Math.Between(-550, -420);
        break;
      case 'criss-cross':
        if (index % 2 === 0) {
          spawnX = -50; spawnY = screenHeight * 0.8 + Phaser.Math.Between(-30, 30);
          velocityX = Phaser.Math.Between(320, 420); velocityY = Phaser.Math.Between(-600, -480);
        } else {
          spawnX = screenWidth + 50; spawnY = screenHeight * 0.8 + Phaser.Math.Between(-30, 30);
          velocityX = Phaser.Math.Between(-420, -320); velocityY = Phaser.Math.Between(-600, -480);
        }
        break;
      case 'side-throw':
        if (Math.random() < 0.5) {
          spawnX = -50; spawnY = screenHeight * (0.5 + Math.random() * 0.2);
          velocityX = Phaser.Math.Between(250, 380); velocityY = Phaser.Math.Between(-520, -400);
        } else {
          spawnX = screenWidth + 50; spawnY = screenHeight * (0.5 + Math.random() * 0.2);
          velocityX = Phaser.Math.Between(-380, -250); velocityY = Phaser.Math.Between(-520, -400);
        }
        break;
      default:
        if (totalCount === 1) {
          const centralZone = screenWidth * 0.6;
          const startPos = screenWidth * 0.2;
          spawnX = startPos + Math.random() * centralZone;
        } else {
          const centralZone = screenWidth * 0.7;
          const startPos = screenWidth * 0.15;
          const spacing = centralZone / Math.max(totalCount - 1, 1);
          spawnX = startPos + (spacing * index) + Phaser.Math.Between(-30, 30);
        }
        spawnY = screenHeight + 50;
        const speedVariation = totalCount > 1 ? Phaser.Math.Between(-80, 100) : Phaser.Math.Between(-60, 80);
        const launchSpeed = baseSpeed + speedVariation;
        velocityX = totalCount > 1 ? Phaser.Math.Between(-120, 120) : Phaser.Math.Between(-100, 100);
        velocityY = -launchSpeed;
        break;
    }
    return { spawnX, spawnY, velocityX, velocityY };
  }

  updateSliceChain(sliceQuality: string): void {
    this.sliceChainProgress++;
    if (sliceQuality === 'perfect') this.sliceChainProgress += 2;
    const requiredProgress = this.sliceChainLevel * gameplayConfig.sliceChainBaseProgress.value;
    if (this.sliceChainProgress >= requiredProgress) {
      this.sliceChainLevel++; this.sliceChainProgress = 0;
      this.showChainLevelUpEffect();
    }
  }

  checkPerfectStreak(): void {
    if (this.currentPerfectStreak > this.perfectSliceStreak) {
      this.perfectSliceStreak = this.currentPerfectStreak;
      this.saveProgress('perfectSliceStreak', this.perfectSliceStreak);
    }
    if (this.currentPerfectStreak >= gameplayConfig.perfectStreakThreshold.value &&
        this.currentPerfectStreak % gameplayConfig.perfectStreakThreshold.value === 0) {
      this.showPerfectStreakEffect(this.currentPerfectStreak);
      this.perfectStreakSound?.play({ rate: 1.0 + (this.currentPerfectStreak * 0.1) });
    }
  }

  checkOnFireMode(): void {
    this.fireStreakCount++;
    if (this.fireStreakCount >= gameplayConfig.onFireThreshold.value && !this.isOnFire) this.activateOnFireMode();
    this.time.delayedCall(2000, () => { if (!this.isOnFire) this.fireStreakCount = 0; });
  }

  activateOnFireMode(): void {
    this.isOnFire = true;
    this.onFireModeSound?.play();
    if (!this.onFireBrightness) {
      if (this.frenzyColorMatrix) this.onFireBrightness = this.frenzyColorMatrix;
      else this.onFireBrightness = this.cameras.main.postFX.addColorMatrix();
    }
    if (this.isFrenzyMode && this.frenzyColorMatrix === this.onFireBrightness) this.onFireBrightness.hue(30).brightness(1.3);
    else this.onFireBrightness.brightness(1.3);
    this.showOnFireEffect();
    this.time.delayedCall(gameplayConfig.onFireDuration.value, () => this.deactivateOnFireMode());
  }

  deactivateOnFireMode(): void {
    this.isOnFire = false; this.fireStreakCount = 0;
    if (this.onFireBrightness) {
      this.tweens.addCounter({
        from: 1.3, to: 1.0, duration: 300,
        onUpdate: (tw)=> {
          if (this.onFireBrightness) {
            if (this.isFrenzyMode && this.frenzyColorMatrix===this.onFireBrightness) this.onFireBrightness.hue(30).brightness(tw.getValue());
            else this.onFireBrightness.brightness(tw.getValue());
          }
        },
        onComplete: ()=> {
          if (this.onFireBrightness) {
            if (this.isFrenzyMode && this.frenzyColorMatrix===this.onFireBrightness) { this.onFireBrightness.hue(30).brightness(1.0); }
            else { this.onFireBrightness.brightness(1.0); if (this.frenzyColorMatrix !== this.onFireBrightness) this.onFireBrightness = null; }
            if (this.frenzyColorMatrix !== this.onFireBrightness) this.onFireBrightness = null;
          }
        }
      });
    }
  }

  cleanupPostProcessingEffects(): void {
    if (this.frenzyColorMatrix && this.frenzyColorMatrix === this.onFireBrightness) {
      this.frenzyColorMatrix.hue(0).brightness(1.0);
      this.frenzyColorMatrix = null; this.onFireBrightness = null;
    } else {
      if (this.frenzyColorMatrix) { this.frenzyColorMatrix.hue(0); this.frenzyColorMatrix = null; }
      if (this.onFireBrightness) { this.onFireBrightness.brightness(1.0); this.onFireBrightness = null; }
    }
    this.cameras.main.postFX.clear();
  }

  checkPersonalBest(): void {
    if (this.isGameOver && this.score > this.personalBest) {
      this.personalBest = this.score;
      this.saveProgress('personalBest', this.personalBest);
      this.showPersonalBestEffect();
    }
  }

  detectNearMiss(x: number, y: number): void {
    const missRadius = 80;
    this.fruits.children.entries.forEach(f => {
      const fruitSprite = f as Phaser.GameObjects.Image;
      if (!fruitSprite.active || (fruitSprite as any).isSliced) return;
      const distance = Phaser.Math.Distance.Between(x, y, fruitSprite.x, fruitSprite.y);
      if (distance < missRadius && distance > 65) {
        this.nearMissCount++;
        this.showNearMissEffect(fruitSprite);
        this.nearMissSound?.play({ rate: 0.8 });
      }
    });
  }

  checkSpectacularSlice(slicedCount: number): void {
    if (slicedCount >= gameplayConfig.spectacularSliceThreshold.value) {
      this.spectacularSlices++;
      this.lastSpectacularTime = this.time.now;
      this.showSpectacularSliceEffect(slicedCount);
      this.spectacularSliceSound?.play({ rate: 1.0 + (slicedCount * 0.2) });
      const bonusPoints = slicedCount * 50;
      this.score += bonusPoints;
      this.createFloatingScoreText(this.scale.gameSize.width/2, this.scale.gameSize.height/2, bonusPoints, 'spectacular');
    }
  }

  // Visual effect methods
  showStreakNotification(streak: number): void {
    const text = this.add.text(this.scale.gameSize.width/2, 100, `🔥 ${streak} DAY STREAK! 🔥`, {
      fontSize: '48px', color: '#ff6b35', fontStyle: 'bold', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5);
    this.tweens.add({ targets: text, scale: { from: 0, to: 1.2 }, alpha: { from: 1, to: 0 }, y: text.y - 50, duration: 3000, ease: 'Bounce.easeOut', onComplete: () => text.destroy() });
  }

  showChainLevelUpEffect(): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText(`CHAIN Lv.${this.sliceChainLevel}`);
    t.setPosition(this.scale.gameSize.width - 120, 100);
    t.setColor('#ffd700');
    t.setVisible(true).setActive(true).setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: t, alpha: 1, y: t.y - 10, duration: 220, ease: 'Power2' });
    this.tweens.add({ delay: 900, targets: t, alpha: 0, y: t.y - 10, duration: 240, onComplete: ()=>t.setVisible(false).setActive(false) });
  }

  showPerfectStreakEffect(streak: number): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText(`PERFECT x${streak}`);
    t.setPosition(this.scale.gameSize.width/2, this.scale.gameSize.height*0.28);
    t.setColor('#66ff99');
    t.setVisible(true).setActive(true).setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: t, alpha:1, scaleX:1.2, scaleY:1.2, duration:200, ease:'Back.Out' });
    this.tweens.add({ delay:700, targets:t, alpha:0, duration:250, onComplete:()=>t.setVisible(false).setActive(false) });
  }

  showOnFireEffect(): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const bar = this.add.rectangle(this.scale.gameSize.width/2, 12, this.scale.gameSize.width, 6, 0xff6b35, 0.7).setDepth(200);
    this.tweens.add({ targets: bar, alpha: 0, duration: 500, ease: 'Power2', onComplete: ()=>bar.destroy() });
  }

  showPersonalBestEffect(): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText('NEW PERSONAL BEST!');
    t.setPosition(this.scale.gameSize.width/2, this.scale.gameSize.height*0.4);
    t.setColor('#ffe066');
    t.setVisible(true).setActive(true).setAlpha(0);
    this.tweens.add({ targets:t, alpha:1, duration:260, ease:'Power2' });
    this.tweens.add({ delay:1200, targets:t, alpha:0, duration:300, onComplete:()=>t.setVisible(false).setActive(false) });
  }

  showNearMissEffect(fruit: Phaser.GameObjects.Image): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText('CLOSE!');
    t.setPosition(fruit.x, fruit.y - 60);
    t.setColor('#ffea00');
    t.setVisible(true).setActive(true).setAlpha(1).setScale(1);
    this.tweens.add({ targets: t, alpha:0, y: t.y - 30, duration: 420, ease:'Power2', onComplete: ()=>t.setVisible(false).setActive(false) });
  }

  showSpectacularSliceEffect(count: number): void {
    if (!PRESENTATION_ONLY || REDUCED_MOTION) return;
    const t = this.nextPopup();
    t.setText(`SPECTACULAR! x${count}`);
    t.setPosition(this.scale.gameSize.width/2, this.scale.gameSize.height/2 - 100);
    t.setColor('#a78bfa');
    t.setVisible(true).setActive(true).setAlpha(0).setScale(0.8);
    this.tweens.add({ targets:t, alpha:1, scaleX:1.25, scaleY:1.25, duration:200, ease:'Back.Out' });
    this.tweens.add({ delay:700, targets:t, alpha:0, duration:280, onComplete:()=>t.setVisible(false).setActive(false) });
  }

  update(): void {
    if (this.isGameOver || this.isPaused) return;
    if (this.isFrenzyMode && this.time.now > this.frenzyModeEndTime) this.deactivateFrenzyMode();
    
    this.fruits.children.entries.forEach(f => {
      const fruitSprite = f as Phaser.GameObjects.Image;
      if (!fruitSprite.active) return;
      const fruitData = (fruitSprite as any).fruitData;
      const throwPattern = (fruitSprite as any).throwPattern || 'classic';
      let shouldRemove = false, shouldLoseLife = false;
      const fallThreshold = this.scale.gameSize.height + 50;
      const sideThreshold = 250;
      
      if (fruitSprite.y > fallThreshold) {
        shouldRemove = true;
        shouldLoseLife = !fruitData.isBomb && !fruitData.isGolden && !(fruitSprite as any).isSliced;
      } else if (fruitSprite.x < -sideThreshold || fruitSprite.x > this.scale.gameSize.width + sideThreshold) {
        shouldRemove = true;
        if (throwPattern === 'classic' || (fruitSprite.x > this.scale.gameSize.width * 0.1 && fruitSprite.x < this.scale.gameSize.width * 0.9)) {
          shouldLoseLife = !fruitData.isBomb && !fruitData.isGolden && !(fruitSprite as any).isSliced;
        }
      } else if (fruitSprite.y < -600) {
        shouldRemove = true;
      }
      
      if (shouldRemove) {
        if (shouldLoseLife && !this.activeGoldenFruit) this.loseLife();
        fruitSprite.setActive(false).setVisible(false);
      }
    });
    
    this.fruits.children.entries = this.fruits.children.entries.filter(f => f.active);
    this.updateMusicIntensity();
  }

  loseLife(): void {
    this.lives--;
    this.events.emit('livesUpdated', this.lives);
    this.currentSliceStreak = 0;
    this.events.emit('streakUpdated', this.currentSliceStreak);
    if (this.lives <= 0) this.gameOver();
  }

  gameOver(): void {
    this.isGameOver = true;
    this.checkPersonalBest();
    const newRank = utils.addHighScore(this.score);
    const isHighScore = utils.isHighScore(this.score);
    const highScores = utils.getHighScores();
    if (this.fruitSpawnTimer) this.fruitSpawnTimer.destroy();
    if (this.comboTimer) this.comboTimer.destroy();
    if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();
    this.physics.world.timeScale = 1;
    this.time.timeScale = 1;
    this.deactivateGoldenFruitZoom();
    this.gameOverSound?.play();
    this.scene.launch("GameOverUIScene", {
      currentLevelKey: this.scene.key, finalScore: this.score, newRank, isHighScore, highScores
    });
  }

  getDifficultyLevel(): number { return Math.floor(this.score / gameplayConfig.difficultyIncreaseInterval.value); }

  getDifficultyProgress(): number {
    const scoreInCurrentLevel = this.score % gameplayConfig.difficultyIncreaseInterval.value;
    return scoreInCurrentLevel / gameplayConfig.difficultyIncreaseInterval.value;
  }

  interpolateDifficulty(minValue: number, maxValue: number, maxDifficultyLevel: number = 10): number {
    const currentLevel = this.getDifficultyLevel();
    const progress = Math.min(currentLevel / maxDifficultyLevel, 1.0);
    const easedProgress = this.easeInOutQuad(progress);
    return minValue + (maxValue - minValue) * easedProgress;
  }

  easeInOutQuad(t: number): number { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  getEffectiveDifficultyLevel(): number {
    let effectiveDifficultyLevel = this.getDifficultyLevel();
    if (this.time.now < this.postGoldenFruitCooldown) {
      const cooldownProgress = (this.postGoldenFruitCooldown - this.time.now) / 3000;
      const difficultyReduction = Math.floor(cooldownProgress * 3);
      effectiveDifficultyLevel = Math.max(0, effectiveDifficultyLevel - difficultyReduction);
    }
    return effectiveDifficultyLevel;
  }

  calculateDifficultyValue(currentLevel: number, minValue: number, maxValue: number, maxDifficultyLevel: number = 10): number {
    const progress = Math.min(currentLevel / maxDifficultyLevel, 1.0);
    const easedProgress = this.easeInOutQuad(progress);
    return minValue + (maxValue - minValue) * easedProgress;
  }

  checkDifficultyProgression(): void {
    const newLevel = this.getDifficultyLevel();
    if (newLevel > this.currentDifficultyLevel) {
      this.currentDifficultyLevel = newLevel;
      this.updateSpawnRate();
      if (newLevel <= 10) this.events.emit('difficultyIncreased', { level: newLevel });
      this.lastDifficultyUpdateScore = this.score;
    } else if (this.score - this.lastDifficultyUpdateScore >= 50) {
      this.updateSpawnRate();
      this.lastDifficultyUpdateScore = this.score;
    }
    if (this.time.now < this.postGoldenFruitCooldown) this.updateSpawnRate();
  }

  restart(): void {
    if (this.backgroundMusic) { this.backgroundMusic.stop(); this.backgroundMusic.destroy(); this.backgroundMusic = undefined as any; }
    this.lives = gameplayConfig.lives.value;
    this.score = 0; this.combo = 0; this.isGameOver = false; this.activeGoldenFruit = null;
    this.goldenFruitSliceCount = 0; this.goldenFruitLastSliceTime = 0; this.hasShownDifficultyIncrease = false;
    this.isGoldenFruitZoomed = false; this.currentDifficultyLevel = 0; this.lastDifficultyUpdateScore = 0;
    this.postGoldenFruitCooldown = 0;
    this.gameStartTime = this.time.now; this.timeBasedDifficultyLevel = 0; this.lastTimeBasedIncrease = 0;
    this.rapidFireMode = false; this.rapidFireEndTime = 0; this.chaosMode = false; this.chaosModeEndTime = 0;
    this.isFrenzyMode = false; this.frenzyModeEndTime = 0; this.totalSlices = 0; this.perfectSlices = 0;
    this.currentSliceStreak = 0; this.maxCombo = 0; this.scoreMultiplier = 1; this.lastSliceTime = 0;

    // ensure input state is clean
    this.isPaused = false;
    this.isSlicing = false;
    this.slicePath = [];
    this.lastSlicePoint = undefined;

    // clear groups (destroy old children) then REBUILD presentation pools
    this.fruits.clear(true, true);
    this.sliceTrails.clear(true, true);
    this.particles.clear(true, true);

    // 🔧 Critical fix: the slice/popup pools were destroyed above; rebuild them
    this.rewarmPresentationPools();

    this.physics.world.timeScale = 1; this.time.timeScale = 1;
    this.cleanupPostProcessingEffects();
    this.deactivateGoldenFruitZoom();
    this.startFruitSpawning();
    this.events.emit('gameRestarted');
    this.events.emit('scoreUpdated', this.score);
    this.events.emit('livesUpdated', this.lives);
    this.events.emit('comboUpdated', this.combo);
    this.events.emit('streakUpdated', this.currentSliceStreak);
  }

  shutdown(): void {
    if (this.backgroundMusic) { this.backgroundMusic.stop(); this.backgroundMusic.destroy(); this.backgroundMusic = undefined as any; }
    if (this.fruitSpawnTimer) this.fruitSpawnTimer.destroy();
    if (this.comboTimer) this.comboTimer.destroy();
    if (this.goldenFruitTimer) this.goldenFruitTimer.destroy();
  }

  // Enhanced Difficulty Progression System
  updateEnhancedDifficulty(): void { this.updateTimeBasedDifficulty(); this.updateSpecialModes(); this.checkSpecialModeActivation(); }

  updateTimeBasedDifficulty(): void {
    const gameTime = this.time.now - this.gameStartTime;
    const newTimeLevel = Math.floor(gameTime / gameplayConfig.timeBasedDifficultyInterval.value);
    const maxTimeLevel = gameplayConfig.maxTimeBasedDifficulty.value;
    if (newTimeLevel > this.timeBasedDifficultyLevel && newTimeLevel <= maxTimeLevel) {
      this.timeBasedDifficultyLevel = newTimeLevel;
      this.lastTimeBasedIncrease = this.time.now;
      this.events.emit('timeDifficultyIncreased', { level: this.timeBasedDifficultyLevel, message: `Time Pressure Level ${this.timeBasedDifficultyLevel}!` });
      this.updateSpawnRate();
    }
  }

  updateSpecialModes(): void {
    if (this.rapidFireMode && this.time.now > this.rapidFireEndTime) { this.rapidFireMode = false; this.updateSpawnRate(); this.events.emit('rapidFireEnded'); }
    if (this.chaosMode && this.time.now > this.chaosModeEndTime) { this.chaosMode = false; this.updateSpawnRate(); this.events.emit('chaosModeEnded'); }
  }

  checkSpecialModeActivation(): void {
    const totalDifficulty = this.getTotalDifficultyLevel();
    if (!this.rapidFireMode && !this.chaosMode && totalDifficulty >= 5 && Math.random() < 0.02) this.activateRapidFireMode();
    if (!this.rapidFireMode && !this.chaosMode && totalDifficulty >= 8 && Math.random() < 0.015) this.activateChaosMode();
  }

  activateRapidFireMode(): void {
    this.rapidFireMode = true;
    this.rapidFireEndTime = this.time.now + 10000;
    this.updateSpawnRate();
    this.events.emit('rapidFireActivated', { message: "RAPID FIRE MODE!", duration: 10000 });
    this.cameras.main.shake(100, 0.01);
  }

  activateChaosMode(): void {
    this.chaosMode = true;
    this.chaosModeEndTime = this.time.now + 15000;
    this.updateSpawnRate();
    this.events.emit('chaosModeActivated', { message: "CHAOS MODE!", duration: 15000 });
    this.cameras.main.shake(200, 0.02);
  }

  getTotalDifficultyLevel(): number {
    const scoreDifficulty = this.getDifficultyLevel();
    const timeDifficulty = this.timeBasedDifficultyLevel;
    return Math.max(scoreDifficulty, timeDifficulty) + Math.floor(Math.min(scoreDifficulty, timeDifficulty) / 2);
  }

  createChaosPattern(baseCount: number): void {
    const chaosPatterns = ['spiral', 'wave', 'bombardment', 'pincer'];
    const pattern = Phaser.Utils.Array.GetRandom(chaosPatterns);
    const fruitCount = Math.max(baseCount, 5);
    switch (pattern) {
      case 'spiral': this.createSpiralPattern(fruitCount); break;
      case 'wave': this.createWavePattern(fruitCount); break;
      case 'bombardment': this.createBombardmentPattern(fruitCount); break;
      case 'pincer': this.createPincerPattern(fruitCount); break;
    }
  }

  createRapidFireBurst(): void {
    const burstCount = Phaser.Math.Between(3, 6);
    for (let i = 0; i < burstCount; i++) {
      this.time.delayedCall(i * 200, () => { if (!this.isGameOver) this.createSingleFruit(0, 1, 'fruit'); });
    }
  }

  createSpiralPattern(count: number): void {
    const angleStep = 360 / count;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 150, () => { if (!this.isGameOver) this.createSingleFruit(i, count, undefined, 'spiral'); });
    }
  }

  createWavePattern(count: number): void {
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 100, () => { if (!this.isGameOver) this.createSingleFruit(i, count, undefined, 'wave'); });
    }
  }

  createBombardmentPattern(count: number): void {
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 120, () => { if (!this.isGameOver) { const type = Math.random() < 0.3 ? 'bomb' : 'fruit'; this.createSingleFruit(i, count, type); } });
    }
  }

  createPincerPattern(count: number): void {
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

  createFruitTrail(_fruit: Phaser.GameObjects.Image, _fruitData: any): void {
    // Trail particles intentionally disabled (use slice trail lines instead)
  }

  createHourglassSparkles(_hourglass: Phaser.GameObjects.Image): void {
    // Sparkles omitted for perf; glow handled in addGoldenGlowEffect
  }

  initializeBackgroundMusic(): void {
    if (this.backgroundMusic) { this.backgroundMusic.stop(); this.backgroundMusic.destroy(); }
    const musicVolume = parseFloat(localStorage.getItem('sliceSurge_musicVolume') || '0.6');
    const masterVolume = parseFloat(localStorage.getItem('sliceSurge_masterVolume') || '1.0');
    try {
      this.backgroundMusic = this.sound.add("ninja_dojo_music", { volume: musicVolume * masterVolume, loop: true });
      this.backgroundMusic.play();
    } catch {}
    this.currentMusicIntensity = 1.0;
    this.targetMusicIntensity = 1.0;
  }

  updateMusicIntensity(): void {
    if (!this.backgroundMusic) return;
    let intensity = 1.0;
    if (this.combo >= 10) intensity = 1.4;
    else if (this.combo >= 5) intensity = 1.2;
    if (this.isFrenzyMode) intensity *= 1.3;
    if (this.isOnFire) intensity *= 1.2;
    if (this.chaosMode || this.rapidFireMode) intensity *= 1.25;
    this.targetMusicIntensity = Math.min(intensity, 1.8);
    if (Math.abs(this.currentMusicIntensity - this.targetMusicIntensity) > 0.01) {
      this.currentMusicIntensity += (this.currentMusicIntensity < this.targetMusicIntensity ? 1 : -1) * this.musicTransitionSpeed;
      (this.backgroundMusic as any).setRate(this.currentMusicIntensity);
    }
  }

  pauseGame(): void {
    this.isPaused = true;
    if (this.backgroundMusic && this.backgroundMusic.isPlaying) this.backgroundMusic.pause();
    this.scene.launch("PauseMenuScene", { gameSceneKey: this.scene.key });
  }

  resumeGame(): void {
    this.isPaused = false;
    if (this.backgroundMusic) {
      if (this.backgroundMusic.isPaused) this.backgroundMusic.resume();
      else if (!this.backgroundMusic.isPlaying) {
        const musicVolume = parseFloat(localStorage.getItem('sliceSurge_musicVolume') || '0.6');
        const masterVolume = parseFloat(localStorage.getItem('sliceSurge_masterVolume') || '1.0');
        (this.backgroundMusic as any).setVolume(musicVolume * masterVolume);
        this.backgroundMusic.play();
      }
    }
  }
}
