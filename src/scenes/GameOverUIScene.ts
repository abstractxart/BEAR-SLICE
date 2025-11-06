import Phaser from 'phaser';
import * as utils from '../utils';
import { BEARParkAPI } from '../BEARParkAPI';

export class GameOverUIScene extends Phaser.Scene {
  private currentLevelKey: string | null;
  private finalScore: number;
  private newRank: number | null;
  private isHighScore: boolean;
  private highScores: utils.HighScoreEntry[];
  private isRestarting: boolean;
  private uiContainer: Phaser.GameObjects.DOMElement | null;
  private enterKey?: Phaser.Input.Keyboard.Key;
  private spaceKey?: Phaser.Input.Keyboard.Key;

  constructor() {
    super({
      key: "GameOverUIScene",
    });
    this.currentLevelKey = null;
    this.finalScore = 0;
    this.newRank = null;
    this.isHighScore = false;
    this.highScores = [];
    this.isRestarting = false;
    this.uiContainer = null;
  }

  init(data: { 
    currentLevelKey?: string; 
    finalScore?: number; 
    newRank?: number | null;
    isHighScore?: boolean;
    highScores?: utils.HighScoreEntry[];
  }) {
    // Receive data from level scene
    this.currentLevelKey = data.currentLevelKey || "FruitSliceGameScene";
    this.finalScore = data.finalScore || 0;
    this.newRank = data.newRank || null;
    this.isHighScore = data.isHighScore || false;
    this.highScores = data.highScores || [];
    // Reset restart flag
    this.isRestarting = false;

    // Submit score to BEAR Park central leaderboard
    BEARParkAPI.submitScore(this.finalScore).then(result => {
      if (result.success && result.is_high_score) {
        console.log('🎉 New BEAR Park high score!');
      }
    }).catch(error => {
      console.error('Error submitting to BEAR Park:', error);
    });
  }

  create(): void {
    // Create DOM UI
    this.createDOMUI();
    // Setup input controls
    this.setupInputs();
  }

  createDOMUI(): void {
    // BEAR Park Theme Colors
    const colors = {
      gold: '#edb723',
      purple: '#680cd9',
      yellow: '#feb501',
      green: '#07ae08',
      charcoal: '#141619',
      ink: '#0b0d0e'
    };

    const newHighScoreText = this.isHighScore
      ? `<div style="
           font-size: 28px;
           color: ${colors.gold};
           text-shadow: 3px 3px 0px #000000;
           animation: sparkle 0.5s ease-in-out infinite alternate;
           margin-bottom: 20px;
           font-family: 'Luckiest Guy', cursive;
         ">✨ NEW HIGH SCORE! ✨</div>`
      : '';

    // Generate leaderboard HTML with BEAR Park style
    const leaderboardHTML = this.highScores.map((entry, index) => {
      const isCurrentScore = this.isHighScore && entry.score === this.finalScore && entry.rank === this.newRank;
      const medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : ''));
      const borderColor = index === 0 ? '#FFD700' : (index === 1 ? '#C0C0C0' : (index === 2 ? '#CD7F32' : colors.gold));
      const borderWidth = index === 0 ? '6px' : (index === 1 ? '5px' : (index === 2 ? '5px' : '4px'));
      const bgGradient = index === 0
        ? 'linear-gradient(135deg, rgba(237, 183, 35, 0.3) 0%, rgba(255, 215, 0, 0.2) 100%)'
        : (index === 1
          ? 'linear-gradient(135deg, rgba(192, 192, 192, 0.2) 0%, rgba(169, 169, 169, 0.15) 100%)'
          : (index === 2
            ? 'linear-gradient(135deg, rgba(205, 127, 50, 0.2) 0%, rgba(184, 115, 51, 0.15) 100%)'
            : 'linear-gradient(135deg, rgba(104, 12, 217, 0.15) 0%, rgba(7, 174, 8, 0.15) 100%)'));

      return `
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          margin-bottom: 8px;
          border-radius: 8px;
          background: ${bgGradient};
          border-left: ${borderWidth} solid ${borderColor};
          transition: all 0.2s ease;
          font-family: 'Luckiest Guy', cursive;
        " onmouseover="this.style.transform='translateX(6px)'" onmouseout="this.style.transform='translateX(0)'">
          <div style="font-size: 20px; color: ${colors.gold}; text-shadow: 1px 1px 0px #000; min-width: 40px;">
            ${medal || `#${index + 1}`}
          </div>
          <div style="font-size: 18px; color: #fff; text-shadow: 1px 1px 0px #000; flex: 1; margin: 0 10px;">
            ${entry.score.toLocaleString()}
          </div>
          <div style="font-size: 13px; color: ${colors.yellow}; text-shadow: 1px 1px 0px #000;">
            ${entry.date}
          </div>
        </div>
      `;
    }).join('') || '<div style="color: #fff; font-size: 18px; text-align: center;">No scores yet!</div>';

    const uiHTML = `
      <div id="game-over-container" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100vh;
        background: linear-gradient(180deg, ${colors.charcoal} 0%, ${colors.ink} 100%);
        z-index: 10000;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Luckiest Guy', cursive;
      ">
        <div style="
          max-width: 600px;
          width: 100%;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-height: 100vh;
        ">

          <!-- Game Over Title -->
          <div style="
            font-size: 48px;
            text-align: center;
            color: #ff3333;
            text-shadow: 4px 4px 0px #000000;
            animation: gameOverPulse 1s ease-in-out infinite alternate;
            font-family: 'Luckiest Guy', cursive;
          ">GAME OVER</div>

          ${newHighScoreText}

          <!-- Score Card with Tri-Color Border -->
          <div style="
            position: relative;
            background: radial-gradient(500px 200px at 50% -20%, rgba(118,174,255,.12), transparent 60%), ${colors.ink};
            border-radius: 20px;
            padding: 20px;
            isolation: isolate;
          ">
            <!-- Tri-color border -->
            <div style="
              content: '';
              position: absolute;
              inset: 0;
              border-radius: 20px;
              padding: 3px;
              background: linear-gradient(135deg, ${colors.purple} 0%, ${colors.purple} 33.33%, ${colors.yellow} 33.33%, ${colors.yellow} 66.66%, ${colors.green} 66.66%, ${colors.green} 100%);
              -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
              -webkit-mask-composite: xor;
              mask-composite: exclude;
              pointer-events: none;
              z-index: 0;
              opacity: 1;
            "></div>

            <div style="font-size: 18px; color: ${colors.gold}; text-shadow: 2px 2px 0px rgba(0,0,0,0.5); margin-bottom: 4px; text-transform: uppercase; text-align: center; position: relative; z-index: 1;">
              FINAL SCORE
            </div>
            <div style="font-size: 40px; color: #fff; text-shadow: 3px 3px 0px rgba(0,0,0,0.5); text-align: center; position: relative; z-index: 1;">
              ${this.finalScore.toLocaleString()}
            </div>
          </div>

          <!-- Leaderboard Title -->
          <div style="
            font-size: 24px;
            color: ${colors.gold};
            text-shadow: 2px 2px 0px #000;
            text-align: center;
            text-transform: uppercase;
            font-family: 'Luckiest Guy', cursive;
          ">🏆 TOP 5 SCORES 🏆</div>

          <!-- Leaderboard (scrollable) -->
          <div style="
            background: radial-gradient(500px 200px at 50% -20%, rgba(118,174,255,.08), transparent 60%), ${colors.ink};
            border-radius: 16px;
            padding: 12px;
            max-height: 200px;
            overflow-y: auto;
          ">
            ${leaderboardHTML}
          </div>

          <!-- Retry Button -->
          <button
            id="restart-button"
            style="
              width: 100%;
              padding: 16px;
              font-size: 28px;
              font-family: 'Luckiest Guy', cursive;
              background: linear-gradient(135deg, #ff3333 0%, #cc0000 100%);
              color: #fff;
              border: 3px solid rgba(255,255,255,.3);
              border-radius: 12px;
              cursor: pointer;
              box-shadow: 0 4px 16px rgba(255,51,51,.5);
              transition: all 0.2s ease;
              text-shadow: 2px 2px 0px #000;
              animation: blink 1s ease-in-out infinite alternate;
            "
            onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 6px 20px rgba(255,51,51,.7)';"
            onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 16px rgba(255,51,51,.5)';"
            onmousedown="this.style.transform='scale(0.95)';"
            onmouseup="this.style.transform='scale(1.05)';"
          >
            TAP TO RETRY
          </button>

          <!-- Main Menu Button -->
          <button
            id="menu-button"
            style="
              width: 100%;
              padding: 12px;
              font-size: 20px;
              font-family: 'Luckiest Guy', cursive;
              background: rgba(255,255,255,0.1);
              color: #fff;
              border: 2px solid rgba(255,255,255,.3);
              border-radius: 10px;
              cursor: pointer;
              transition: all 0.2s ease;
              text-shadow: 2px 2px 0px #000;
            "
            onmouseover="this.style.background='rgba(255,255,255,0.2)'; this.style.borderColor='${colors.gold}';"
            onmouseout="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='rgba(255,255,255,.3)';"
          >
            MAIN MENU
          </button>

        </div>

        <!-- Custom Animations -->
        <style>
          @keyframes gameOverPulse {
            from { transform: scale(1); }
            to { transform: scale(1.05); }
          }

          @keyframes blink {
            from { opacity: 0.8; }
            to { opacity: 1; }
          }

          @keyframes sparkle {
            from {
              filter: brightness(1);
              transform: scale(1);
            }
            to {
              filter: brightness(1.3);
              transform: scale(1.05);
            }
          }

          @media (max-width: 600px) {
            #game-over-container > div:first-child {
              padding-top: 20px;
            }
          }
        </style>
      </div>
    `;

    // Add DOM element to scene
    this.uiContainer = utils.initUIDom(this, uiHTML);
  }

  setupInputs(): void {
    // Clear previous event listeners
    this.input.off('pointerdown');
    
    // Create keyboard input
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Listen for key events
    this.enterKey.on('down', () => this.restartGame());
    this.spaceKey.on('down', () => this.restartGame());

    // Setup button click handlers
    const restartButton = document.getElementById('restart-button');
    const menuButton = document.getElementById('menu-button');

    if (restartButton) {
      restartButton.addEventListener('click', () => this.restartGame());
    }

    if (menuButton) {
      menuButton.addEventListener('click', () => this.goToMainMenu());
    }
  }

  restartGame(): void {
    // Prevent multiple triggers
    if (this.isRestarting) return;
    this.isRestarting = true;

    console.log(`Restarting game: ${this.currentLevelKey}`);

    // Clear event listeners
    this.clearEventListeners();

    // Stop all game-related scenes
    this.scene.stop("UIScene");
    this.scene.stop(this.currentLevelKey!);
    
    // Restart the game scene
    this.scene.start(this.currentLevelKey!);
  }

  goToMainMenu(): void {
    // Prevent multiple triggers
    if (this.isRestarting) return;
    this.isRestarting = true;

    console.log("Going to main menu");

    // Clear event listeners
    this.clearEventListeners();

    // Stop all game-related scenes
    this.scene.stop("UIScene");
    this.scene.stop(this.currentLevelKey!);
    
    // Go to title screen
    this.scene.start("TitleScreen");
  }

  clearEventListeners(): void {
    // Clear keyboard event listeners
    if (this.enterKey) {
      this.enterKey.off('down');
    }
    if (this.spaceKey) {
      this.spaceKey.off('down');
    }

    // Clear button event listeners
    const restartButton = document.getElementById('restart-button');
    const menuButton = document.getElementById('menu-button');

    if (restartButton) {
      restartButton.removeEventListener('click', () => this.restartGame());
    }

    if (menuButton) {
      menuButton.removeEventListener('click', () => this.goToMainMenu());
    }
  }

  update(): void {
    // Game Over UI scene doesn't need special update logic
  }
}