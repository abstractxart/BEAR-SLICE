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
    // Generate high score text based on new rank
    const highScoreText = this.isHighScore 
      ? (this.newRank === 1 
        ? "🏆 NEW HIGH SCORE! 🏆" 
        : `⭐ HIGH SCORE #${this.newRank}! ⭐`)
      : "";

    // Generate leaderboard HTML
    const leaderboardHTML = this.generateLeaderboardHTML();

    const uiHTML = `
      <div id="game-over-container" class="fixed top-0 left-0 w-full h-full pointer-events-none z-[1000] font-supercell flex" style="background-color: rgba(51, 0, 0, 0.8);">
        
        <!-- Left Side - Game Over Content -->
        <div class="flex-1 flex flex-col justify-center items-center p-6 pointer-events-auto">
          
          <!-- Game Over Title -->
          <div id="game-over-title" class="text-red-500 font-bold pointer-events-none mb-4" style="
            font-size: 48px;
            text-shadow: 4px 4px 0px #000000;
            animation: dangerBlink 0.5s ease-in-out infinite alternate;
          ">GAME OVER</div>

          <!-- High Score Achievement (if applicable) -->
          ${this.isHighScore ? `
          <div class="text-yellow-400 font-bold pointer-events-none mb-4" style="
            font-size: 24px;
            text-shadow: 2px 2px 0px #000000;
            animation: blink 1s ease-in-out infinite alternate;
          ">${highScoreText}</div>
          ` : ''}

          <!-- Final Score -->
          <div class="game-3d-container-blue-600 px-6 py-3 text-white font-bold pointer-events-none mb-6" style="
            font-size: 32px;
            text-shadow: 2px 2px 0px #000000;
          ">Final Score: ${this.finalScore.toLocaleString()}</div>

          <!-- Encouragement Text -->
          <div id="failure-text" class="text-white font-bold pointer-events-none mb-8" style="
            font-size: 22px;
            text-shadow: 2px 2px 0px #000000;
            line-height: 1.4;
            max-width: 400px;
            text-align: center;
          ">Can you slice more 🐻 artifacts next time?</div>

          <!-- Buttons Container -->
          <div class="flex flex-col items-center gap-3">
            <!-- Restart Button -->
            <div id="restart-button" class="game-3d-container-clickable-green-600 px-6 py-3 text-white font-bold pointer-events-auto cursor-pointer" style="
              font-size: 28px;
              text-shadow: 3px 3px 0px #000000;
              animation: blink 0.8s ease-in-out infinite alternate;
            ">RESTART GAME</div>
            
            <!-- Main Menu Button -->
            <div id="menu-button" class="game-3d-container-clickable-gray-600 px-6 py-3 text-white font-bold pointer-events-auto cursor-pointer" style="
              font-size: 22px;
              text-shadow: 2px 2px 0px #000000;
            ">MAIN MENU</div>
          </div>

        </div>

        <!-- Right Side - Leaderboard -->
        <div class="flex-1 flex flex-col justify-center items-center p-6 pointer-events-auto">
          
          <!-- Leaderboard Title -->
          <div class="text-yellow-400 font-bold pointer-events-none mb-6" style="
            font-size: 36px;
            text-shadow: 3px 3px 0px #000000;
          ">🏆 TOP 10 HIGH SCORES 🏆</div>

          <!-- Leaderboard Container -->
          <div class="game-3d-container-slot-gray-800 p-4 w-full max-w-md overflow-y-auto max-h-96" style="
            background-color: rgba(0, 0, 0, 0.7);
          ">
            ${leaderboardHTML}
          </div>

        </div>

        <!-- Custom Animations -->
        <style>
          @keyframes dangerBlink {
            from { 
              opacity: 0.5; 
              filter: brightness(1);
            }
            to { 
              opacity: 1; 
              filter: brightness(1.2);
            }
          }
          
          @keyframes blink {
            from { opacity: 0.3; }
            to { opacity: 1; }
          }

          @keyframes highlightGlow {
            from { 
              background-color: rgba(255, 215, 0, 0.3);
              transform: scale(1);
            }
            to { 
              background-color: rgba(255, 215, 0, 0.6);
              transform: scale(1.02);
            }
          }

          .highlight-score {
            animation: highlightGlow 1s ease-in-out infinite alternate;
          }
        </style>
      </div>
    `;

    // Add DOM element to scene
    this.uiContainer = utils.initUIDom(this, uiHTML);
  }

  generateLeaderboardHTML(): string {
    if (this.highScores.length === 0) {
      return `
        <div class="text-center text-gray-400 py-8" style="
          font-size: 18px;
          text-shadow: 1px 1px 0px #000000;
        ">
          No scores yet!<br>
          Be the first to set a record!
        </div>
      `;
    }

    let leaderboardHTML = '';
    
    this.highScores.forEach((entry, index) => {
      const isCurrentScore = this.isHighScore && entry.score === this.finalScore && entry.rank === this.newRank;
      const rankDisplay = index + 1;
      
      // Medal icons for top 3
      let medalIcon = '';
      if (rankDisplay === 1) medalIcon = '🥇';
      else if (rankDisplay === 2) medalIcon = '🥈';
      else if (rankDisplay === 3) medalIcon = '🥉';
      else medalIcon = `${rankDisplay}.`;

      const highlightClass = isCurrentScore ? 'highlight-score' : '';
      
      leaderboardHTML += `
        <div class="flex justify-between items-center py-2 px-3 mb-2 rounded ${highlightClass}" style="
          background-color: ${isCurrentScore ? 'rgba(255, 215, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)'};
          border: ${isCurrentScore ? '2px solid #FFD700' : '1px solid rgba(255, 255, 255, 0.2)'};
        ">
          <div class="flex items-center gap-2">
            <span style="
              font-size: 18px;
              min-width: 30px;
              text-align: center;
            ">${medalIcon}</span>
            <span style="
              font-size: 16px;
              color: ${isCurrentScore ? '#FFD700' : '#FFFFFF'};
              font-weight: ${isCurrentScore ? 'bold' : 'normal'};
              text-shadow: 1px 1px 0px #000000;
            ">${entry.score.toLocaleString()}</span>
          </div>
          <span style="
            font-size: 14px;
            color: #CCCCCC;
            text-shadow: 1px 1px 0px #000000;
          ">${entry.date}</span>
        </div>
      `;
    });

    return leaderboardHTML;
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