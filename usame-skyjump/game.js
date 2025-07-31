class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TitleScene' });
    }

    preload() {
        // Load the spritesheet for Usame
        this.load.spritesheet('usame', 'sprites/usame.png', {
            frameWidth: 1024,
            frameHeight: 1024
        });
    }

    createTitleAssets() {
        const graphics = this.add.graphics();
        
        // Create Game Boy style background (green tint)
        graphics.fillStyle(0x8BAC0F); // Game Boy green
        graphics.fillRect(0, 0, 800, 600);
        graphics.generateTexture('title-bg', 800, 600);
        graphics.destroy();
    }

    create() {
        // Create assets first
        this.createTitleAssets();
        
        // Add Game Boy style background
        this.add.image(400, 300, 'title-bg');

        // Add static Usame from spritesheet (frame 0)
        const titleUsame = this.add.sprite(400, 200, 'usame', 0);

        // Define the desired on-screen width for the sprite
        const targetWidth = 150; // You can adjust this value

        // Calculate the scale needed to achieve the target width
        const scale = targetWidth / titleUsame.width;
        // Apply the calculated scale and set the origin
        titleUsame.setScale(scale).setOrigin(0.5);

        // Add Japanese title text
        const titleText = this.add.text(400, 340, 'うさめちゃんのスカイジャンプ', {
            fontSize: '48px',
            fontFamily: 'bold serif', // Include weight in font string
            color: '#306230',
            align: 'center',
            stroke: '#9bbc0f',
            strokeThickness: 3
        });
        titleText.setShadow(2, 2, '#1e2928', 2, false, true); // Use proper shadow API
        titleText.setOrigin(0.5);
        
        // Add a subtle animation to make it more fancy
        this.tweens.add({
            targets: titleText,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 2000,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });

        // Add "Press ENTER" text with blinking effect
        const pressEnterText = this.add.text(400, 450, 'PRESS ENTER or TAP', {
            fontSize: '18px',
            fontFamily: 'Courier New',
            color: '#306230',
            align: 'center'
        });
        pressEnterText.setOrigin(0.5);

        // Blinking animation
        this.tweens.add({
            targets: pressEnterText,
            alpha: 0,
            duration: 800,
            ease: 'Power2',
            yoyo: true,
            repeat: -1
        });

        // --- Fan Game Credit & Copyright Notice ---
        const creditLines = [
            '非公式ファンゲーム',
            '制作：A. STAFFINI',
            'キャラクター：ペンギンボックス『おでかけ子ザメ』より（© PENGUINBOX）',
            '本作はペンギンボックス先生への敬意を込めた作品です'
        ];

        const startY = 480;         // sit right under your "PRESS ENTER" line
        const lineHeight = 20;      // vertical spacing between each line
        creditLines.forEach((line, i) => {
            this.add.text(400, startY + i * lineHeight, line, {
                fontSize: '14px',
                fontFamily: 'Courier New',
                color: '#F0EAD6',
                align: 'center'
            })
            .setOrigin(0.5);
        });

        // Add floating animation to Usame
        this.tweens.add({
            targets: titleUsame,
            y: 180,
            duration: 2000,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });

        // Listen for ENTER key to start the game
        this.input.keyboard.on('keydown-ENTER', () => {
            this.scene.start('GameScene', { audioTrigger: true });
        });
        
        // Listen for a tap/click to start the game
        this.input.once('pointerdown', () => {
            this.scene.start('GameScene', { audioTrigger: true });
        });

        // Copyright text
        const copyrightText = this.add.text(400, 560, '© 2025 Ninjin Labs', {
            fontSize: '12px',
            fontFamily: 'Courier New',
            color: '#306230',
            align: 'center'
        });
        copyrightText.setOrigin(0.5);
    }
}

class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.platforms = null;
        this.player = null;
        this.carrots = null;
        this.heightScore = 0;
        this.carrotScore = 0;
        this.maxHeight = 0;
        this.cursors = null;
        this.groundLevel = 0;
        this.highestPlatformY = 0; // Track the highest platform generated


        // how long after leaving a ledge you can still jump (ms)
        this.coyoteTime = 120;
        // how long before landing a jump press will be remembered (ms)
        this.jumpBufferTime = 120;

        // timers
        this.timeSinceGround = 0;         // ms since we were last on solid ground
        this.timeSinceJumpPressed = Infinity; // ms since jump key was last pressed

        // mobile input properties
        this.activePointerId = null; // Tracks the single active finger
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartTime = 0;
        this.isTouchMoving = 0; // -1 for left, 0 for none, 1 for right
        this.touchJumpHeld = false; // tracks if touch jump is being held

        // Crumbling platform tracking
        this.crumblingPlatforms = new Map(); // Track which platforms are crumbling and their timers
    }

    init(data) {
        this.audioTrigger = data.audioTrigger || false;
        
        // Platform generation tunables (start safe, get harder)
        this.MIN_DY = 90;          // min vertical gap
        this.MAX_DY_START = 130;   // early game max gap
        this.MAX_DY_END = 180;     // late game max gap (still under 225)
        this.MAX_DX = 220;         // horizontal step per rung (<= reach)
        this.PATH_X_MIN = -1000;   // keep inside your world span
        this.PATH_X_MAX = 1000;

        // Geometry of platform sprite
        this.PLATFORM_W = 120;
        this.PLATFORM_H = 20;

        // How much clear space we want above a platform so jumps aren't blocked
        this.HEADROOM = 70;

        // If two platforms are at similar heights (|dy| < HEADROOM), require this horizontal gap
        this.MIN_SAMELEVEL_GAP = 160;

        // Store placed platforms to check future placement against
        this.placed = []; // push {x,y}

        // Multi-lane system (2-3 guaranteed routes)
        this.LANES = [-700, 0, 700];      // for 3 lanes; use [-500, 500] for 2 lanes
        this.laneX = [...this.LANES];     // current x per lane
        this.rowTopTarget = -5000;        // how high to pre-generate in one go

        // practical reach (keep under the theoretical 225/300)
        this.REACH_Y = 200;  // safe vertical
        this.REACH_X = 240;  // safe horizontal

        // difficulty progression
        this.ROW_DY_START = 90;
        this.ROW_DY_END = 160;   // <= REACH_Y
        this.LANE_JITTER = 160;  // dx step within reach

        // how far above the player we guarantee content is already built (no popping)
        this.PREBUILD_SCREENS = 6;                         // tune to taste
        this.PREBUILD_AHEAD = this.PREBUILD_SCREENS * 600; // 600 = game height

        // how far below the player we keep before cleaning up
        this.CLEANUP_SCREENS = 4;
        this.CLEANUP_BELOW = this.CLEANUP_SCREENS * 600;
    }

    // linear ease from a->b by t in [0,1]
    lerp(a, b, t) { 
        return a + (b - a) * Phaser.Math.Clamp(t, 0, 1); 
    }

    /**
     * Calculates platform width based on height, mixing normal and short platforms.
     * The probability of a platform being short increases in a "mixing zone".
     * @param {number} h The current height in meters.
     * @returns {number} The calculated width of the platform.
     */
    getPlatformWidthForHeight(h) {
        // --- Configuration ---
        const mixStartHeight = 1800; // Height at which short platforms START appearing
        const mixEndHeight = 2500;   // Height at which ALL platforms become short
        const minWidth = 70;         // The width of a "short" platform
        const maxWidth = this.PLATFORM_W; // The width of a "normal" platform (120)

        // --- Logic ---
        // 1. Below the mixing zone, all platforms are normal width
        if (h <= mixStartHeight) {
            return maxWidth;
        }

        // 2. Above the mixing zone, all platforms are short
        if (h >= mixEndHeight) {
            return minWidth;
        }

        // 3. We are inside the mixing zone. Calculate the probability
        // This creates a value from 0.0 to 1.0 representing our progress through the zone
        const probabilityShort = (h - mixStartHeight) / (mixEndHeight - mixStartHeight);

        // Roll the dice: if a random number is less than our probability, spawn a short platform
        if (Math.random() < probabilityShort) {
            return minWidth;
        } else {
            return maxWidth;
        }
    }

    // stricter AABB test with margins; handles variable platform widths
    canPlace(x, y) {
        // Calculate the width of the new platform we are trying to place
        const h = Math.max(0, Math.floor((this.groundLevel - this.groundOffset - y) / 10));
        const newPlatformWidth = this.getPlatformWidthForHeight(h);

        const H = this.PLATFORM_H;
        const PAD_X = 24; 
        const PAD_Y = Math.max(this.HEADROOM, H + 44);

        // Only check against platforms within a reasonable vertical range for performance
        const CHECK_RANGE = 1200;

        for (const p of this.placed) {
            // Optimization: Skip platforms that are too far away vertically
            if (Math.abs(y - p.y) > CHECK_RANGE) {
                continue;
            }

            // Use the actual widths for a precise collision check
            const existingPlatformWidth = p.width || this.PLATFORM_W; // Fallback for old entries
            const totalHalfWidth = (newPlatformWidth / 2) + (existingPlatformWidth / 2);

            const dx = Math.abs(x - p.x);
            const dy = Math.abs(y - p.y);
            
            // AABB check using the combined half-widths and padding
            const overlapX = dx < (totalHalfWidth + PAD_X);
            const overlapY = dy < (H + PAD_Y);
            if (overlapX && overlapY) return false;
        }
        return true;
    }


    createPlatform(x, y, {oneWay = true, crumbling = false} = {}) {
        // Calculate the height and determine the correct width and scale for this platform
        const h = Math.max(0, Math.floor((this.groundLevel - this.groundOffset - y) / 10));
        const newWidth = this.getPlatformWidthForHeight(h);
        const scaleX = newWidth / this.PLATFORM_W; // PLATFORM_W is the original texture width (120)

        const texture = crumbling ? 'crumblingPlatform' : 'platform';
        const p = this.platforms.create(x, y, texture);
        
        p.setScale(scaleX, 1); // Apply the calculated scale
        p.refreshBody();       // IMPORTANT: Update the physics body to match the new scale
        
        // Make most platforms one-way (land from above, pass from below)
        if (oneWay) {
            p.body.checkCollision.down = false;
            p.body.checkCollision.left = false;
            p.body.checkCollision.right = false;
        }
        
        // Mark as crumbling platform
        if (crumbling) {
            p.isCrumbling = true;
            p.originalTexture = texture;
        }
        
        // Store the actual final width for accurate collision checking by canPlace
        this.placed.push({ x, y, width: newWidth });
        return p;
    }

    ensurePrebuilt() {
        // y decreases upward; we want content up to (player.y - PREBUILD_AHEAD)
        let targetTopY = (this.player ? this.player.y : this.groundLevel) - this.PREBUILD_AHEAD;

        if (this.topBuiltY === undefined) {
            // first call: nothing built yet above initial platforms
            this.topBuiltY = this.highestPlatformY || (this.groundLevel - 120);
        }

        // keep extending lanes upward until we've built well above the camera
        while (this.topBuiltY > targetTopY) {
            const before = this.topBuiltY;
            this.buildNextRow();

            // nothing new was placed → stop to avoid a spin-lock
            if (this.topBuiltY === before) break;
        }
    }

    buildNextRow() {
        const t = Phaser.Math.Clamp((this.groundLevel - (this.pathY || (this.groundLevel - 120))) / 15000, 0, 1);
        const dy = Phaser.Math.Between(this.ROW_DY_START, Math.round(this.lerp(this.ROW_DY_START, this.ROW_DY_END, t)));

        const rowY = (this.pathY ?? (this.groundLevel - 120)) - dy;

        // Calculate crumbling platform chance based on height (more common higher up)
        const currentHeight = Math.max(0, Math.floor((this.groundLevel - this.groundOffset - rowY) / 10));
        const crumblingChance = Math.min(0.6, currentHeight / 2000); // Max 60% chance at 2000m height

        // place one guaranteed platform per lane (within reach + spacing rules)
        for (let i = 0; i < this.laneX.length; i++) {
            const targetX = Phaser.Math.Clamp(
                this.laneX[i] + Phaser.Math.Between(-this.LANE_JITTER, this.LANE_JITTER),
                this.PATH_X_MIN, this.PATH_X_MAX
            );

            const W = this.PLATFORM_W;
            const PADX = 20;
            const step = W + PADX;

            // 1) try target + discrete steps left/right (clears neighbors cleanly)
            let placed = false;
            const OFFSETS = [0, -1, 1, -2, 2, -3, 3];
            for (const m of OFFSETS) {
                const tx = Phaser.Math.Clamp(targetX + m * step, this.PATH_X_MIN, this.PATH_X_MAX);
                const ty = rowY;
                
                if (this.canPlace(tx, ty)) {
                    const shouldCrumble = Math.random() < crumblingChance;
                    this.createPlatform(tx, ty, { crumbling: shouldCrumble });
                    this.laneX[i] = tx;
                    placed = true;
                    break;
                }
            }

            // 2) if still crowded, go a bit higher to create headroom
            if (!placed) {
                for (let bump = 1; bump <= 2 && !placed; bump++) {
                    const ty = rowY - bump * this.HEADROOM;
                    
                    if (this.canPlace(targetX, ty)) {
                        const shouldCrumble = Math.random() < crumblingChance;
                        this.createPlatform(targetX, ty, { crumbling: shouldCrumble });
                        this.laneX[i] = targetX;
                        placed = true;
                        break;
                    }
                }
            }

            // 3) if we still can't place, skip this lane for this row (other lanes keep path alive)
            if (placed) {
                if (Math.random() < 0.25) {
                    this.spawnCarrot(this.laneX[i], rowY);
                }
            }
        }

        // optional bridges between neighbor lanes
        const bridges = Phaser.Math.Between(0, 2);
        for (let b = 0; b < bridges; b++) {
            const a = Phaser.Math.Between(0, this.laneX.length - 2);
            const bx = Phaser.Math.Clamp((this.laneX[a] + this.laneX[a + 1]) / 2 + Phaser.Math.Between(-80, 80), this.PATH_X_MIN, this.PATH_X_MAX);
            const by = rowY + Phaser.Math.Between(-10, 10);

            if (this.canPlace(bx, by)) {
                // Bridges are usually regular platforms, but occasionally crumbling
                const shouldCrumble = Math.random() < crumblingChance * 0.5; // Half the chance for bridges
                this.createPlatform(bx, by, { crumbling: shouldCrumble });
                if (Math.random() < 0.2) this.spawnCarrot(bx, by);
            }
        }

        // update cursors for next row
        this.pathY = rowY;
        this.topBuiltY = Math.min(this.topBuiltY, rowY);
        this.highestPlatformY = Math.min(this.highestPlatformY, rowY);
    }

    spawnCarrot(x, y) {
        const CARROT_W = 32, CARROT_H = 48, BODY_W = 24, BODY_H = 36;
        const c = this.carrots.create(x, y - 25, 'carrot');
        c.setDisplaySize(CARROT_W, CARROT_H);
        c.body.setSize(BODY_W, BODY_H);
        c.body.setOffset((CARROT_W - BODY_W)/2, (CARROT_H - BODY_H)/2);
        c.refreshBody();
    }

    preload() {
        // Add loader error handling
        this.load.on('loaderror', file => console.error('Load error:', file.key, file.src));
        this.load.on('filecomplete', (key, type, data) => {
            console.log(`[loaded] ${type}: ${key}`);
        });
        this.load.on('fileerror', (fileObj) => {
            console.warn('[fileerror]', fileObj.key, fileObj.src);
        });
        this.load.on('complete', () => {
            console.log('Textures in cache:', Object.keys(this.textures.list));
            if (this.textures.exists('carrot')) {
                const f = this.textures.getFrame('carrot');
                console.log('carrot size:', f.width, f.height);
            } else {
                console.warn('carrot is NOT in cache after preload.');
            }
            if (this.textures.exists('moon')) {
                const f = this.textures.getFrame('moon');
                console.log('moon size:', f.width, f.height);
            } else {
                console.warn('moon is NOT in cache after preload.');
            }
        });
        
        // Load external sprites (paths are relative to HTML file)
        this.load.image('carrot', 'sprites/carrot.png');
        this.load.image('moon', 'sprites/moon.png');
        this.load.image('octopus', 'sprites/octopus.png');
        
        // Load usame spritesheet (3 × 1 frames: idle, jump, fall)
        this.load.spritesheet('usame', 'sprites/usame.png', {
            frameWidth: 1024,
            frameHeight: 1024
        });

        // Sanity check for spritesheet loading
        this.load.once('complete', () => {
            const f0 = this.textures.getFrame('usame', 0);
            console.log('usame frame0:', f0 ? f0.width + 'x' + f0.height : 'missing');
        });
        
        this.createPixelAssets();
        this.createSounds();
    }

    createPixelAssets() {
        const graphics = this.add.graphics();
        
        // Usame sprite loaded from spritesheet - no need to generate

        // Create platform sprite
        graphics.fillStyle(0x4A4A4A); // Dark gray
        graphics.fillRect(0, 0, 120, 20);
        graphics.fillStyle(0x6A6A6A); // Lighter gray top
        graphics.fillRect(0, 0, 120, 8);
        graphics.generateTexture('platform', 120, 20);
        graphics.clear();

        // Create crumbling platform sprite (brown)
        graphics.fillStyle(0x8B4513); // Dark brown
        graphics.fillRect(0, 0, 120, 20);
        graphics.fillStyle(0xCD853F); // Lighter brown top
        graphics.fillRect(0, 0, 120, 8);
        // Add some cracks for visual distinction
        graphics.fillStyle(0x654321); // Very dark brown for cracks
        graphics.fillRect(20, 4, 2, 16);
        graphics.fillRect(50, 2, 2, 18);
        graphics.fillRect(90, 3, 2, 17);
        graphics.generateTexture('crumblingPlatform', 120, 20);
        graphics.clear();

        // Create full-width ground sprite
        graphics.fillStyle(0x4A4A4A); // Dark gray
        graphics.fillRect(0, 0, 800, 40);
        graphics.fillStyle(0x6A6A6A); // Lighter gray top
        graphics.fillRect(0, 0, 800, 16);
        graphics.generateTexture('ground', 800, 40);
        graphics.clear();


        // Create building background
        graphics.fillStyle(0x1A1A2E); // Dark blue night
        graphics.fillRect(0, 0, 800, 600);
        graphics.fillStyle(0x16213E); // Building color
        for (let i = 0; i < 10; i++) {
            const x = i * 80;
            const height = Phaser.Math.Between(200, 500);
            graphics.fillRect(x, 600 - height, 70, height);
            
            // Add windows
            graphics.fillStyle(0xFFFF00); // Yellow windows
            for (let j = 0; j < height / 40; j++) {
                if (Math.random() > 0.3) {
                    graphics.fillRect(x + 10 + (j % 3) * 20, 600 - height + j * 40 + 10, 8, 12);
                }
            }
            graphics.fillStyle(0x16213E);
        }
        graphics.generateTexture('cityscape', 800, 600);
        graphics.clear();

        // Create night sky background with stars (much larger to ensure full coverage)
        graphics.fillStyle(0x0F0F23); // Deep night blue
        graphics.fillRect(0, 0, 1600, 1200); // Much larger than screen with generous margins
        
        // Add stars across the entire larger background
        graphics.fillStyle(0xFFFFFF); // White stars
        for (let i = 0; i < 120; i++) {
            const starX = Math.random() * 1600;
            const starY = Math.random() * 700; // Keep stars in upper portion
            const starSize = Math.random() * 2 + 1;
            graphics.fillCircle(starX, starY, starSize);
        }
        
        // Add some twinkling effect with different colored stars
        graphics.fillStyle(0xFFFFAA); // Yellowish stars
        for (let i = 0; i < 50; i++) {
            const starX = Math.random() * 1600;
            const starY = Math.random() * 600;
            graphics.fillCircle(starX, starY, 1);
        }
        
        graphics.generateTexture('nightsky', 1600, 1200); // Much larger texture
        graphics.clear();

        // Create enhanced deep space background with relaxing cosmic elements
        graphics.fillStyle(0x0a0520); // Deep purple-black space
        graphics.fillRect(0, 0, 1600, 1200);

        // Large distant nebulae (very subtle and calming)
        const nebulaColors = [0x2d1b40, 0x1a2040, 0x40202d, 0x204030, 0x3d2040];
        for (let i = 0; i < 12; i++) {
            const x = Phaser.Math.Between(0, 1600);
            const y = Phaser.Math.Between(0, 1200);
            const w = Phaser.Math.Between(600, 1000);
            const h = Phaser.Math.Between(400, 700);
            const color = Phaser.Math.RND.pick(nebulaColors);
            graphics.fillStyle(color, 0.06);
            graphics.fillEllipse(x, y, w, h);
        }

        // Medium nebula clouds for depth
        for (let i = 0; i < 20; i++) {
            const x = Phaser.Math.Between(0, 1600);
            const y = Phaser.Math.Between(0, 1200);
            const w = Phaser.Math.Between(200, 400);
            const h = Phaser.Math.Between(150, 350);
            graphics.fillStyle(0x503060, 0.04);
            graphics.fillEllipse(x, y, w, h);
        }

        // Fine space dust (micro stars)
        for (let i = 0; i < 600; i++) {
            const x = Math.random() * 1600;
            const y = Math.random() * 1200;
            const alpha = Math.random() * 0.3 + 0.1;
            graphics.fillStyle(0xe6f3ff, alpha);
            graphics.fillRect(x, y, 1, 1);
        }
        
        graphics.generateTexture('deepSpace', 1600, 1200);
        graphics.clear();

        // Create additional celestial textures
        this.createCelestialTextures(graphics);

        graphics.destroy();
    }

    createCelestialTextures(graphics) {
        // Create asteroid textures
        const asteroidSizes = [6, 8, 10, 12];
        asteroidSizes.forEach((size, i) => {
            graphics.fillStyle(0x8B7355, 1);
            // Irregular shape for asteroid
            for (let y = -size/2; y <= size/2; y += 2) {
                for (let x = -size/2; x <= size/2; x += 2) {
                    const dist = Math.sqrt(x*x + y*y);
                    const noise = Math.sin(x*0.5) * Math.cos(y*0.5) * 2;
                    if (dist + noise <= size/2) {
                        graphics.fillRect(x + size, y + size, 2, 2);
                    }
                }
            }
            // Add some darker spots
            graphics.fillStyle(0x654321, 1);
            graphics.fillRect(size + 2, size - 2, 2, 2);
            graphics.fillRect(size - 4, size + 2, 2, 2);
            graphics.generateTexture(`asteroid-${i}`, size * 2, size * 2);
            graphics.clear();
        });

        // Create varied moon textures
        const moonSizes = [8, 10, 12];
        const moonColors = [0xD3D3D3, 0xC0C0C0, 0xB8B8B8];
        moonSizes.forEach((size, i) => {
            const color = moonColors[i];
            graphics.fillStyle(color, 1);
            // Create circular moon
            for (let y = -size; y <= size; y += 2) {
                for (let x = -size; x <= size; x += 2) {
                    if (x*x + y*y <= size*size) {
                        graphics.fillRect(x + size, y + size, 2, 2);
                    }
                }
            }
            // Add craters
            graphics.fillStyle(0x999999, 1);
            graphics.fillRect(size + 2, size - 2, 2, 2);
            graphics.fillRect(size - 3, size + 1, 2, 2);
            graphics.generateTexture(`moon-${i}`, size * 2, size * 2);
            graphics.clear();
        });

        // Create comet particle texture with glow
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(6, 6, 3);
        graphics.fillStyle(0xccddff, 0.8);
        graphics.fillCircle(6, 6, 5);
        graphics.fillStyle(0x99bbff, 0.4);
        graphics.fillCircle(6, 6, 7);
        graphics.generateTexture('comet-glow', 12, 12);
        graphics.clear();

        // Create satellite texture
        graphics.fillStyle(0xCCCCCC, 1);
        graphics.fillRect(2, 4, 8, 4); // Main body
        graphics.fillStyle(0x666666, 1);
        graphics.fillRect(0, 5, 2, 2); // Left panel
        graphics.fillRect(10, 5, 2, 2); // Right panel
        graphics.fillStyle(0xFF0000, 1);
        graphics.fillRect(5, 6, 2, 1); // Red light
        graphics.generateTexture('satellite', 12, 8);
        graphics.clear();

        // Create enhanced spiral galaxy texture
        const galaxySize = 120;
        graphics.fillStyle(0x4A5FFF, 0.3); // Blue core
        graphics.fillCircle(galaxySize/2, galaxySize/2, 15);
        
        // Create spiral arms
        for (let i = 0; i < 400; i++) {
            const angle = i * 0.08;
            const distance = i * 0.25;
            const x = Math.cos(angle) * distance + galaxySize/2;
            const y = Math.sin(angle) * distance + galaxySize/2;
            const alpha = Math.max(0, 0.6 - (distance / (galaxySize/2)));
            graphics.fillStyle(0xFFFFFF, alpha * 0.7);
            graphics.fillCircle(x, y, 1);
            
            // Second spiral arm
            const x2 = Math.cos(angle + Math.PI) * distance + galaxySize/2;
            const y2 = Math.sin(angle + Math.PI) * distance + galaxySize/2;
            graphics.fillStyle(0xDDDDFF, alpha * 0.5);
            graphics.fillCircle(x2, y2, 1);
        }
        graphics.generateTexture('spiral-galaxy', galaxySize, galaxySize);
        graphics.clear();

        // Create space dust particle textures (various sizes)
        for (let i = 0; i < 3; i++) {
            const size = i + 1;
            graphics.fillStyle(0xE6F3FF, 0.6);
            graphics.fillRect(0, 0, size, size);
            graphics.generateTexture(`dust-${i}`, size, size);
            graphics.clear();
        }

        // Create simple planet textures to fix missing texture issue
        const planetDefs = [
            { key: 'planet-blue',    body: 0x4a5fff, ring: 0xaad4ff },
            { key: 'planet-orange',  body: 0xffb347, ring: 0xffdab3 },
            { key: 'planet-purple',  body: 0xb47bff, ring: 0xdac3ff },
            { key: 'planet-green',   body: 0x58d85a, ring: 0xa2f8a4 }
        ];

        planetDefs.forEach(def => {
            const R = 24; // planet radius in pixels
            const W = R * 2;
            graphics.fillStyle(def.body, 1);
            graphics.fillCircle(R, R, R); // solid body

            // Simple horizontal ring (no rotation needed for simplicity)
            graphics.fillStyle(def.ring, 1);
            graphics.fillRect(R - 30, R - 2, 60, 4); // horizontal ring through center
            graphics.fillRect(R - 26, R - 3, 52, 6); // slightly thicker inner part

            graphics.generateTexture(def.key, W, W);
            graphics.clear();
        });
    }

    createDeepSpaceLayers() {
        const cam = this.cameras.main;
        const w = this.scale.width;
        const h = this.scale.height;

        // Helper function for parallax positioning
        const placeParallax = (screenX, screenY, scrollFactor = 0.05) => {
            return new Phaser.Math.Vector2(
                cam.scrollX * scrollFactor + screenX,
                cam.scrollY * scrollFactor + screenY
            );
        };

        // Layer 1: Far background stars (slow parallax) - Creates depth
        this.starLayerFar = this.add.container(0, 0).setDepth(-6).setScrollFactor(0.01);
        this.starLayerFar.setAlpha(0);
        
        for (let i = 0; i < 60; i++) {
            const sx = Phaser.Math.Between(0, w);
            const sy = Phaser.Math.Between(0, Math.floor(h * 0.7));
            const worldPos = placeParallax(sx, sy, 0.01);
            
            const star = this.add.circle(worldPos.x, worldPos.y, 0.5, 0xE6F3FF, 0.3);
            star.setData('sx', sx);
            star.setData('sy', sy);
            this.starLayerFar.add(star);
            
            // Very subtle twinkling
            this.tweens.add({
                targets: star,
                alpha: { from: 0.1, to: 0.4 },
                duration: Phaser.Math.Between(4000, 8000),
                yoyo: true,
                repeat: -1,
                delay: Math.random() * 6000
            });
        }

        // Layer 2: Bright stars (medium parallax) - Main star field
        this.starLayerMid = this.add.container(0, 0).setDepth(-4).setScrollFactor(0.05);
        this.starLayerMid.setAlpha(0);
        
        for (let i = 0; i < 40; i++) {
            const sx = Phaser.Math.Between(0, w);
            const sy = Phaser.Math.Between(0, Math.floor(h * 0.8));
            const worldPos = placeParallax(sx, sy, 0.05);
            
            const starSize = Phaser.Math.FloatBetween(1, 2);
            const starColor = Phaser.Math.RND.pick([0xFFFFFF, 0xFFFFAA, 0xAAFFFF]);
            const star = this.add.circle(worldPos.x, worldPos.y, starSize, starColor);
            star.setData('sx', sx);
            star.setData('sy', sy);
            this.starLayerMid.add(star);
            
            // Gentle twinkling
            this.tweens.add({
                targets: star,
                alpha: { from: 0.4, to: 1.0 },
                scale: { from: 0.8, to: 1.2 },
                duration: Phaser.Math.Between(2000, 4000),
                yoyo: true,
                repeat: -1,
                delay: Math.random() * 3000
            });
        }

        // Layer 3: Asteroids (faster parallax) - Creates motion and interest
        this.asteroidLayer = this.add.container(0, 0).setDepth(-3).setScrollFactor(0.08);
        this.asteroidLayer.setAlpha(0);
        
        for (let i = 0; i < 8; i++) {
            const sx = Phaser.Math.Between(0, w);
            const sy = Phaser.Math.Between(0, Math.floor(h * 0.6));
            const worldPos = placeParallax(sx, sy, 0.08);
            
            const asteroidKey = `asteroid-${Phaser.Math.Between(0, 3)}`;
            const asteroid = this.add.image(worldPos.x, worldPos.y, asteroidKey)
                .setScale(Phaser.Math.FloatBetween(0.6, 1.0))
                .setAlpha(0.8);
            asteroid.setData('sx', sx);
            asteroid.setData('sy', sy);
            asteroid.setData('rotSpeed', Phaser.Math.FloatBetween(0.0003, 0.001));
            asteroid.setData('driftSpeed', Phaser.Math.FloatBetween(0.1, 0.2));
            this.asteroidLayer.add(asteroid);
        }

        // Store simplified layers for easy management
        this.deepSpaceLayers = [
            this.starLayerFar,
            this.starLayerMid,
            this.asteroidLayer
        ];
    }

    createShootingStarSystem() {
        // Container for shooting stars
        this.shootingStars = this.add.group();
        
        // Timer for creating shooting stars (less frequent)
        this.shootingStarTimer = this.time.addEvent({
            delay: Phaser.Math.Between(8000, 15000),
            callback: this.createShootingStar,
            callbackScope: this,
            loop: true
        });
        this.shootingStarTimer.paused = true; // Start paused, activate in deep space
    }

    createShootingStar() {
        const cam = this.cameras.main;
        const w = this.scale.width;
        const h = this.scale.height;
        
        // Random starting position (off-screen)
        const side = Phaser.Math.Between(0, 3); // 0=top, 1=right, 2=bottom, 3=left
        let startX, startY, endX, endY;
        
        switch (side) {
            case 0: // From top
                startX = cam.scrollX + Phaser.Math.Between(0, w);
                startY = cam.scrollY - 50;
                endX = startX + Phaser.Math.Between(-200, 200);
                endY = cam.scrollY + h + 50;
                break;
            case 1: // From right
                startX = cam.scrollX + w + 50;
                startY = cam.scrollY + Phaser.Math.Between(0, h);
                endX = cam.scrollX - 50;
                endY = startY + Phaser.Math.Between(-100, 100);
                break;
            case 2: // From bottom
                startX = cam.scrollX + Phaser.Math.Between(0, w);
                startY = cam.scrollY + h + 50;
                endX = startX + Phaser.Math.Between(-200, 200);
                endY = cam.scrollY - 50;
                break;
            case 3: // From left
                startX = cam.scrollX - 50;
                startY = cam.scrollY + Phaser.Math.Between(0, h);
                endX = cam.scrollX + w + 50;
                endY = startY + Phaser.Math.Between(-100, 100);
                break;
        }
        
        // Create shooting star with glowing trail
        const shootingStar = this.add.image(startX, startY, 'comet-glow')
            .setDepth(-1)
            .setScale(Phaser.Math.FloatBetween(0.8, 1.5))
            .setAlpha(0.9);
        
        this.shootingStars.add(shootingStar);
        
        // Calculate angle for rotation
        const angle = Phaser.Math.Angle.Between(startX, startY, endX, endY);
        shootingStar.setRotation(angle);
        
        // Create trail effect
        const trailLength = 8;
        const trail = [];
        for (let i = 0; i < trailLength; i++) {
            const trailPart = this.add.circle(startX, startY, 
                (trailLength - i) * 0.5, 
                0xFFFFFF, 
                (trailLength - i) * 0.1);
            trailPart.setDepth(-1.1);
            trail.push(trailPart);
            this.shootingStars.add(trailPart);
        }
        
        // Animate shooting star
        const duration = Phaser.Math.Between(1000, 3000);
        
        this.tweens.add({
            targets: shootingStar,
            x: endX,
            y: endY,
            alpha: { from: 0.9, to: 0 },
            duration: duration,
            ease: 'Cubic.easeOut',
            onUpdate: (tween) => {
                // Update trail positions
                const progress = tween.progress;
                for (let i = 0; i < trail.length; i++) {
                    const trailProgress = Math.max(0, progress - (i * 0.02));
                    const trailX = startX + (endX - startX) * trailProgress;
                    const trailY = startY + (endY - startY) * trailProgress;
                    trail[i].setPosition(trailX, trailY);
                }
            },
            onComplete: () => {
                // Clean up
                shootingStar.destroy();
                trail.forEach(part => part.destroy());
                
                // Schedule next shooting star
                this.time.delayedCall(Phaser.Math.Between(2000, 6000), () => {
                    if (!this.shootingStarTimer.paused) {
                        this.createShootingStar();
                    }
                });
            }
        });
    }

    createSounds() {
        // Create simple placeholder sounds first, generate actual audio after user interaction
        this.soundBuffers = {
            jump: null,
            collect: null,
            bgmusic: null
        };
    }

    generateAudioBuffers(audioContext) {
        // Generate jump sound
        this.soundBuffers.jump = this.createJumpSound(audioContext);
        
        // Generate collect sound  
        this.soundBuffers.collect = this.createCollectSound(audioContext);
        
        // Generate background music
        this.soundBuffers.bgmusic = this.createBackgroundMusic(audioContext);
    }

    createJumpSound(audioContext) {
        const sampleRate = audioContext.sampleRate;
        const duration = 0.2;
        const samples = sampleRate * duration;
        const buffer = audioContext.createBuffer(1, samples, sampleRate);
        const data = buffer.getChannelData(0);

        // Generate 8-bit jump sound (frequency sweep up)
        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const frequency = 200 + (300 * t); // Sweep from 200Hz to 500Hz
            const envelope = Math.max(0, 1 - (t / duration)); // Fade out
            data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.3;
        }

        return buffer;
    }

    createCollectSound(audioContext) {
        const sampleRate = audioContext.sampleRate;
        const duration = 0.15;
        const samples = sampleRate * duration;
        const buffer = audioContext.createBuffer(1, samples, sampleRate);
        const data = buffer.getChannelData(0);

        // Generate 8-bit collect sound (quick chirp up)
        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const frequency = 400 + (600 * Math.sin(t * 20)); // Oscillating frequency
            const envelope = Math.max(0, 1 - (t / duration));
            data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.2;
        }

        return buffer;
    }

    createBackgroundMusic(audioContext) {
        const sampleRate = audioContext.sampleRate;
        const bpm = 130; // Beats per minute
        const beatDuration = 60 / bpm; // Duration of one beat in seconds
        const measureDuration = beatDuration * 4; // 4 beats per measure
        const totalMeasures = 8; // Loop over 8 measures
        const duration = measureDuration * totalMeasures;
        const samples = Math.floor(sampleRate * duration);
        const buffer = audioContext.createBuffer(1, samples, sampleRate);
        const data = buffer.getChannelData(0);

        // Music Theory & Structure
        // Chord Progression (in C minor): Cm -> G -> Ab -> Eb
        const progression = [
            { root: 261.63, third: 311.13, fifth: 392.00 }, // Cm
            { root: 392.00, third: 493.88, fifth: 587.33 }, // G
            { root: 415.30, third: 523.25, fifth: 622.25 }, // Ab
            { root: 311.13, third: 392.00, fifth: 466.16 }  // Eb
        ];

        // Melody with notes and their durations in beats
        const melody = [
            { freq: 523.25, dur: 1 }, { freq: 587.33, dur: 1 }, { freq: 622.25, dur: 2 }, // C, D, Eb
            { freq: 523.25, dur: 1 }, { freq: 466.16, dur: 1 }, { freq: 392.00, dur: 2 }, // C, Bb, G
            { freq: 415.30, dur: 1.5 }, { freq: 466.16, dur: 0.5 }, { freq: 523.25, dur: 2 }, // Ab, Bb, C
            { freq: 466.16, dur: 1 }, { freq: 415.30, dur: 1 }, { freq: 392.00, dur: 2 }, // Bb, Ab, G
        ];

        // --- Sound Generation ---
        let melodyTime = 0;
        let melodyNoteIndex = 0;

        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const measure = Math.floor(t / measureDuration);
            const chord = progression[measure % progression.length];
            const timeInMeasure = t % measureDuration;
            const beat = Math.floor(timeInMeasure / beatDuration);

            let sampleValue = 0;

            // 1. Bassline (simple square wave for a retro feel)
            const bassFreq = chord.root / 2; // One octave lower
            const bassEnvelope = Math.exp(- (timeInMeasure / measureDuration) * 2);
            const bassSignal = Math.sign(Math.sin(2 * Math.PI * bassFreq * t)); // Square wave
            sampleValue += bassSignal * 0.08 * bassEnvelope;

            // 2. Arpeggio (triangle wave for a softer texture)
            const arpNotes = [chord.root, chord.third, chord.fifth, chord.third];
            const arpFreq = arpNotes[beat % arpNotes.length];
            const arpEnvelope = Math.exp(- (t % beatDuration) * 5);
            const arpSignal = Math.asin(Math.sin(2 * Math.PI * arpFreq * t)) * (2 / Math.PI); // Triangle wave
            sampleValue += arpSignal * 0.07 * arpEnvelope;

            // 3. Melody (sine wave)
            if (t >= melodyTime) {
                const note = melody[melodyNoteIndex % melody.length];
                melodyTime += note.dur * beatDuration;
                melodyNoteIndex++;
            }
            const currentNote = melody[(melodyNoteIndex - 1) % melody.length];
            const melodyFreq = currentNote.freq;
            const timeInNote = melodyTime - t;
            const noteDur = currentNote.dur * beatDuration;
            if (timeInNote > 0 && timeInNote < noteDur) {
                const melodyEnvelope = Math.sin((timeInNote / noteDur) * Math.PI); // Gentle attack/decay
                const melodySignal = Math.sin(2 * Math.PI * melodyFreq * t);
                sampleValue += melodySignal * 0.12 * melodyEnvelope;
            }
            
            // 4. Percussion (white noise for a snare/hi-hat effect)
            if (beat === 1 || beat === 3) { // On beats 2 and 4
                const timeInBeat = timeInMeasure % beatDuration;
                if (timeInBeat < 0.1) {
                    const noiseEnvelope = Math.exp(-timeInBeat * 40);
                    sampleValue += (Math.random() * 2 - 1) * 0.05 * noiseEnvelope;
                }
            }

            data[i] = sampleValue;
        }

        return buffer;
    }

    playGeneratedSound(bufferKey) {
        if (!this.soundBuffers[bufferKey] || !this.audioContext) return;
        
        const source = this.audioContext.createBufferSource();
        source.buffer = this.soundBuffers[bufferKey];
        source.connect(this.masterGain);
        source.start();
    }

    create() {
        // If carrot didn't load, create a fallback texture matching expected size
        if (!this.textures.exists('carrot')) {
            console.warn('carrot missing – creating fallback.');
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0xFF8C00, 1).fillRect(0, 0, 32, 48); // Match expected 32x48 size
            g.fillStyle(0x228B22, 1).fillRect(8, 0, 16, 16); // Scale up the green top
            g.generateTexture('carrot', 32, 48);
            g.destroy();
        }

        // Set world bounds (limited horizontal movement, infinite vertical climbing)
        this.worldWidth = 2400; // 3x screen width for reasonable horizontal space
        this.physics.world.setBounds(-1200, -100000, this.worldWidth, 100600);
        this.groundLevel = 600;
        this.groundOffset = 60; // Offset for stable ground position in height calculation
        this.leftLimit = this.physics.world.bounds.left + 40;
        this.rightLimit = this.physics.world.bounds.right - 40;
        this.highestPlatformY = this.groundLevel;

        // Add cityscape background (ground level) - use tileSprite to prevent sliding off
        this.cityscapeBackground = this.add.tileSprite(400, 300, 1600, 600, 'cityscape');
        this.cityscapeBackground.setScrollFactor(0.1);
        this.cityscapeBackground.setDepth(-7);
        
        // Add night sky background (higher altitudes) - initially hidden
        // Night sky stays pinned to camera, we scroll the texture inside it
        this.nightskyBackground = this.add.tileSprite(400, 300, 1600, 1200, 'nightsky');
        this.nightskyBackground.setScrollFactor(0); // ← important
        this.nightskyBackground.setAlpha(0); // Start invisible
        this.nightskyBackground.setDepth(-6);

        // Add deep space background (highest altitudes) - initially hidden
        this.deepSpaceBackground = this.add.tileSprite(400, 300, 1600, 1200, 'deepSpace');
        this.deepSpaceBackground.setScrollFactor(0); // Pin to screen
        this.deepSpaceBackground.setAlpha(0); // Start hidden
        this.deepSpaceBackground.setDepth(-5); // Above nightsky


        // Create groups
        this.platforms = this.physics.add.staticGroup();
        this.carrots = this.physics.add.staticGroup(); // Make carrots static so they don't fall

        // Create ground floor that spans the limited world width
        const groundSegments = [];
        const segmentWidth = 800;
        const numSegments = Math.ceil(this.worldWidth / segmentWidth) + 1; // Cover entire world width
        
        for (let i = 0; i < numSegments; i++) {
            const x = -1200 + (i * segmentWidth); // Start from left boundary
            const groundSegment = this.platforms.create(x, this.groundLevel - 20, 'ground');
            groundSegment.refreshBody();
            groundSegment.isPermanent = true;
            // ground stays fully collidable (no one-way tweaks)
            // MODIFICATION: Add the 'width' property for the ground segments
            this.placed.push({ x, y: this.groundLevel - 20, width: segmentWidth });
            groundSegments.push(groundSegment);
        }
        
        this.groundSegments = groundSegments;

        // Seed cursors for rows
        this.pathY = this.groundLevel - 120;
        this.topBuiltY = this.pathY;


        this.ensurePrebuilt();

        // Define usame animations
        // Idle—just frame 0
        this.anims.create({
            key: 'idle',
            frames: [{ key: 'usame', frame: 0 }],
        });

        // Jump—frame 1
        this.anims.create({
            key: 'jump',
            frames: [{ key: 'usame', frame: 1 }],
        });

        // Fall—frame 2
        this.anims.create({
            key: 'fall',
            frames: [{ key: 'usame', frame: 2 }],
        });

        // --- choose on-screen size you want (adjust to taste) ---
        const TARGET_W = 78;
        const TARGET_H = 62.4;

        // Create player (frame 0 = idle)
        this.player = this.physics.add.sprite(400, this.groundLevel - 80, 'usame', 0)
            .setBounce(0.2)
            .setCollideWorldBounds(false);

        // Compute scale from source frame -> target size
        const f0 = this.textures.getFrame('usame', 0); // 1024×1024
        const sx = TARGET_W / f0.width;
        const sy = TARGET_H / f0.height;
        this.player.setScale(sx, sy);

        const SRC_W = f0.width;
        const SRC_H = f0.height;

        // desired hitbox in on-screen pixels
        const BODY_W = 28;
        const BODY_H = 30;
        const FEET_PAD = 2; // on-screen pixels to keep above the platform

        // convert to pre-scale (texture) pixels for Arcade Physics
        const bodyW = BODY_W / sx;
        const bodyH = BODY_H / sy;
        const padSrc = FEET_PAD / sy;

        // IMPORTANT: don't auto-center; we'll set the offset manually
        this.player.body.setSize(bodyW, bodyH, false);

        // center in X, bottom-align in Y, keep a tiny gap (FEET_PAD)
        this.player.body.setOffset(
            (SRC_W - bodyW) / 2,           // center horizontally
            SRC_H - bodyH - padSrc         // stick to the bottom of the sprite
        );

        // Lock render order so platforms never draw over the player
        this.player.setDepth(10);

        // Start idle
        this.player.play('idle');

        // Player physics
        this.playerPlatformCollider = this.physics.add.collider(
            this.player,
            this.platforms,
            this.handlePlayerOnCrumblingPlatform, // Moved to the 3rd argument (collideCallback)
            null,                                 // 4th argument (processCallback) is now null
            this
        );
        this.physics.add.overlap(this.player, this.carrots, this.collectCarrot, null, this);



        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.space = this.input.keyboard.addKey('SPACE'); // Add dedicated SPACE key
        this.input.keyboard.on('keydown-UP',    () => this.timeSinceJumpPressed = 0);
        this.input.keyboard.on('keydown-SPACE', () => this.timeSinceJumpPressed = 0);
        
        // Clear jump buffer on key release for tighter controls
        this.input.keyboard.on('keyup-UP',    () => this.timeSinceJumpPressed = Infinity);
        this.input.keyboard.on('keyup-SPACE', () => this.timeSinceJumpPressed = Infinity);

        // Mobile input handling
        // Thresholds to distinguish a tap from a drag
        const TAP_DURATION_THRESHOLD = 250; // ms
        const TAP_DISTANCE_THRESHOLD = 25;  // pixels
        const DRAG_DISTANCE_THRESHOLD = 30; // pixels to start moving

        // Listen for when a finger first touches the screen
        this.input.on('pointerdown', (pointer) => {
            // Only track the first finger down
            if (this.activePointerId === null) {
                this.activePointerId = pointer.id;
                this.dragStartX = pointer.x;
                this.dragStartY = pointer.y;
                this.dragStartTime = this.time.now;
                this.isTouchMoving = 0;
                
                // Trigger jump immediately and mark as held
                this.timeSinceJumpPressed = 0;
                this.touchJumpHeld = true;
            }
        });

        // Listen for when the finger moves
        this.input.on('pointermove', (pointer) => {
            // Only process movement for the tracked finger
            if (pointer.id !== this.activePointerId) {
                return;
            }

            const dx = pointer.x - this.dragStartX;
            const dy = pointer.y - this.dragStartY;

            // Check if it's a clear horizontal drag
            if (Math.abs(dx) > DRAG_DISTANCE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
                this.isTouchMoving = Math.sign(dx); // -1 for left, 1 for right
            } else {
                this.isTouchMoving = 0;
            }
        });

        // A single function to handle the end of a touch
        const onPointerUp = (pointer) => {
            if (pointer.id !== this.activePointerId) {
                return;
            }

            // Reset all tracking properties
            this.activePointerId = null;
            this.touchJumpHeld = false;
            this.isTouchMoving = 0;
        };

        // Listen for when the finger is lifted or the touch is cancelled
        this.input.on('pointerup', onPointerUp);
        this.input.on('pointercancel', onPointerUp);

        // Camera
        this.cameras.main.startFollow(this.player);
        this.cameras.main.setLerp(0.1, 0.1);
        this.cameras.main.setDeadzone(50, 100);

        // Add moon sprite with parallax and fade (positioned relative to camera)
        if (this.textures.exists('moon')) {
            const { width, height } = this.scale; // 800×600
            const moonFrame = this.textures.getFrame('moon');
            const moonScale = 80 / moonFrame.width; // ~0.078125 to get an ~80px moon
            
            // Place it at 75% across, 15% down the screen, with parallax
            this.moon = this.add.image(
                this.cameras.main.scrollX + width * 0.75,
                this.cameras.main.scrollY + height * 0.15, // initial—will be corrected immediately
                'moon'
            )
                .setScrollFactor(0.05) // slow parallax
                .setScale(moonScale)
                .setAlpha(0) // Start hidden (matches nightsky)
                .setDepth(-2); // Above backgrounds but behind gameplay

            // Immediately correct to the anchored formula
            this.positionMoon();
        } else {
            console.warn('Moon texture missing — skipping moon sprite.');
            this.moon = null;
        }

        // Octopus that replaces the moon in deep space
        if (this.textures.exists('octopus')) {
            const { width, height } = this.scale;
            const octoFrame = this.textures.getFrame('octopus');
            // bump its on‑screen width to about 120px
            const octoScale = 120 / octoFrame.width;
            this.octopus = this.add.image(
                this.cameras.main.scrollX + width * 0.25,  // left side
                this.cameras.main.scrollY + height * 0.15, // SAME height as moon
                'octopus'
            )
            .setScrollFactor(0.05)
            .setScale(octoScale)
            .setAlpha(0)
            .setDepth(-2); // Same depth as moon
        } else {
            this.octopus = null;
        }

        // Create enhanced multi-layer deep space environment
        this.createDeepSpaceLayers();

        // Create shooting star system
        this.createShootingStarSystem();

        // Initialize sound system
        this.soundEnabled = true;
        this.audioInitialized = false;
        this.bgMusicSource = null;

        
        // Sound toggle functionality with null check
        const soundToggle = document.getElementById('sound-toggle');
        if (soundToggle) {
            soundToggle.addEventListener('click', () => {
                this.soundEnabled = !this.soundEnabled;
                if (this.soundEnabled) {
                    soundToggle.textContent = '🔊 Sound ON';
                    if (this.masterGain) {
                        this.masterGain.gain.value = 0.5;
                    }
                    if (!this.bgMusicSource && this.audioInitialized) {
                        this.startBackgroundMusic();
                    }
                } else {
                    soundToggle.textContent = '🔇 Sound OFF';
                    if (this.masterGain) {
                        this.masterGain.gain.value = 0;
                    }
                }
            });
        }
        
        // Initialize audio after user interaction or immediately if triggered from Enter key
        if (this.audioTrigger) {
            this.initializeAudio();
        } else {
            this.input.once('pointerdown', () => {
                this.initializeAudio();
            });
            this.input.keyboard.once('keydown', () => {
                this.initializeAudio();
            });
        }

        // UI updates
        this.updateUI();

        // Register shutdown event to ensure cleanup on scene restart
        this.events.on('shutdown', this.shutdown, this);
    }

    initializeAudio() {
        if (this.audioInitialized) return;
        
        this.audioContext = this.sound.context;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
        this.masterGain.gain.value = this.soundEnabled ? 0.5 : 0;
        
        this.generateAudioBuffers(this.audioContext);
        this.audioInitialized = true;
        
        if (this.soundEnabled) {
            this.startBackgroundMusic();
        }
    }

    startBackgroundMusic() {
        if (!this.soundBuffers.bgmusic || this.bgMusicSource || !this.audioContext) return;
        
        this.bgMusicSource = this.audioContext.createBufferSource();
        this.bgMusicGain = this.audioContext.createGain();
        
        this.bgMusicSource.buffer = this.soundBuffers.bgmusic;
        this.bgMusicSource.loop = true;
        this.bgMusicGain.gain.value = 0.2;
        
        this.bgMusicSource.connect(this.bgMusicGain);
        this.bgMusicGain.connect(this.masterGain);
        this.bgMusicSource.start();
    }


    collectCarrot(player, carrot) {
        carrot.destroy();
        this.carrotScore += 50; // Add to separate carrot score
        if (this.audioInitialized) {
            this.playGeneratedSound('collect');
        }
        this.updateUI();
    }

    handlePlayerOnCrumblingPlatform(player, platform) {
        // We only need to check if the player's bottom is blocked.
        // If it is, the 'platform' argument is guaranteed to be the one it's standing on.
        if (player.body.blocked.down) {
            
            // Now, check if this specific platform is a crumbling one
            // and that we haven't already started the crumbling process for it.
            if (platform.isCrumbling && !this.crumblingPlatforms.has(platform)) {
                
                // This timer will trigger the platform's collapse.
                const crumbleTimer = this.time.addEvent({
                    delay: 500, // 0.5 seconds until it falls
                    callback: () => {
                        platform.disableBody(true, true); // Make the platform disappear and disable physics.
                        
                        // This timer will handle regenerating the platform after a delay.
                        const regenTimer = this.time.addEvent({
                            delay: 3000, // 3 seconds to regenerate
                            callback: () => {
                                // Re-enable the platform at its original position.
                                platform.enableBody(true, platform.x, platform.y, true, true);
                                platform.setAlpha(1); // Make sure it's fully visible again.
                                
                                // Clean up the tracking map so it can crumble again.
                                this.crumblingPlatforms.delete(platform);
                            },
                            callbackScope: this
                        });
                        
                        // Update the map to track the new regeneration timer.
                        this.crumblingPlatforms.set(platform, regenTimer);
                    },
                    callbackScope: this
                });

                // Store the initial crumble timer in the map to prevent this from running again.
                this.crumblingPlatforms.set(platform, crumbleTimer);

                // Add a shaking animation to warn the player that the platform is unstable.
                this.tweens.add({
                    targets: platform,
                    alpha: { from: 1, to: 0.5 },
                    yoyo: true,
                    repeat: 4,
                    duration: 100,
                    ease: 'Power2'
                });
            }
        }
    }

    updateCrumblingPlatforms(delta) {
        // This function is now handled by the collider's processCallback,
        // but we define it to prevent the error.
        // TODO: add other time-based logic here if needed in the future.
    }

    updateUI() {
        // Calculate height so that ground level = 0 (using ground offset for stable ground position)
        const currentHeight = Math.max(0, Math.floor((this.groundLevel - this.groundOffset - this.player.y) / 10));
        if (currentHeight > this.maxHeight) {
            this.maxHeight = currentHeight;
            this.heightScore = this.maxHeight; // Update height score separately
        }

        const totalScore = this.heightScore + this.carrotScore;

        // Update DOM elements with null checks
        const scoreElement = document.getElementById('score');
        const heightElement = document.getElementById('height');
        
        if (scoreElement) {
            scoreElement.textContent = totalScore;
        }
        if (heightElement) {
            heightElement.textContent = currentHeight;
        }
    }

    update(time, delta) {
        const body    = this.player.body;
        const onGround = body.blocked.down || body.touching.down;

        // advance timers
        this.timeSinceGround     = onGround ? 0 : this.timeSinceGround + delta;
        this.timeSinceJumpPressed = Math.min(this.timeSinceJumpPressed + delta, this.jumpBufferTime + 1);

        // decide if we can jump:  
        //  – either still within coyote window after leaving a platform  
        //  – AND we have a buffered jump press  
        const canJump = 
            this.timeSinceGround <= this.coyoteTime &&
            this.timeSinceJumpPressed <= this.jumpBufferTime;

        if (canJump) {
            this.timeSinceJumpPressed = Infinity;   // consume the buffer
            this.player.setVelocityY(-600);
            if (this.audioInitialized) this.playGeneratedSound('jump');
        }

        // optional variable jump height:
        // smoothly dampen jump arc if player lets go of jump keys
        const holdingJump = this.cursors.up.isDown || this.space.isDown || this.touchJumpHeld;
        if (!holdingJump && body.velocity.y < 0) {
            body.velocity.y *= 0.9; // Gradual damping for smoother feel
        }
        // Horizontal movement & flip (combined keyboard/touch input)
        if (this.cursors.left.isDown || this.isTouchMoving < 0) {
            // Move left
            this.player.setVelocityX(-200);
            this.player.setFlipX(false);   // left uses the original art (no flip)
        } else if (this.cursors.right.isDown || this.isTouchMoving > 0) {
            // Move right
            this.player.setVelocityX(200);
            this.player.setFlipX(true);    // right mirrors the left-facing art
        } else {
            // No input, stop moving
            this.player.setVelocityX(0);
            // keep whatever facing we had last
        }

        // Improved animation logic with ground detection
        const vx = body.velocity.x;
        const vy = body.velocity.y;

        // Pick animation
        if (!onGround) {
            // in the air
            if (vy < -20) {
                this.player.play('jump', true);
            } else if (vy > 20) {
                this.player.play('fall', true);
            }
        } else {
            // on the ground
            if (Math.abs(vx) < 5) {
                this.player.play('idle', true);   // stand still
            } else {
                // (no run animation yet, so keep idle while sliding on ground)
                this.player.play('idle', true);
            }
        }


        // Ensure platforms are built ahead of player (capped at finish line)
        this.ensurePrebuilt();

        // Handle crumbling platforms
        this.updateCrumblingPlatforms(delta);

        // Update UI
        this.updateUI();

        
        // Update background based on height
        this.updateBackground();

        // Parallax for the night sky
        this.nightskyBackground.tilePositionY = this.cameras.main.scrollY * 0.1;
        this.nightskyBackground.tilePositionX = this.cameras.main.scrollX * 0.05;

        // Update enhanced deep space layers
        this.updateDeepSpaceLayers(time, delta);

        // Cull far-below stuff but NEVER destroy it
        this.cullFarStuff();

        // Manual horizontal boundary checking
        if (this.player.x < this.leftLimit) {
            this.player.setX(this.leftLimit);
            this.player.setVelocityX(0);
        } else if (this.player.x > this.rightLimit) {
            this.player.setX(this.rightLimit);
            this.player.setVelocityX(0);
        }

        // Reset to ground if fallen too far below or ensure player stays above ground
        if (this.player.y > this.groundLevel + 100) {
            this.player.setPosition(this.player.x, this.groundLevel - 80);
            this.player.setVelocityY(0);
        }

        // Keep moon anchored to screen position with parallax
        this.positionMoon();
        this.positionOctopus();
    }

    generateMorePlatforms() {
        const endY = this.highestPlatformY - 3000;
        // extend the target further up for this batch
        const oldTop = this.rowTopTarget;
        this.rowTopTarget = endY;

        // continue from current laneX positions and pathY
        if (this.pathY > this.highestPlatformY - 120) this.pathY = this.highestPlatformY - 120;

        // reuse the same loop body by calling buildNextRow until target is reached
        while (this.pathY > this.rowTopTarget) {
            this.buildNextRow();
        }

        // restore rowTopTarget if you want fixed total ceiling, or leave as is for endless
        // this.rowTopTarget = oldTop;

        this.cullFarStuff();
    }

    cullFarStuff() {
        const DEACT_Y = this.player.y + this.CLEANUP_BELOW;
        const REACT_Y = this.player.y + this.CLEANUP_BELOW * 0.5;

        this.platforms.children.each(p => {
            if (!p.body || p.isPermanent) return;

            // Deactivate platforms far below
            if (p.y > DEACT_Y && p.active) {
                p.setActive(false).setVisible(false);
                p.body.checkCollision.none = true;
            } 
            // Reactivate platforms that come back into view, BUT ONLY if they are not currently crumbling/regenerating
            else if (p.y <= REACT_Y && !p.active && !this.crumblingPlatforms.has(p)) { // updated line
                p.setActive(true).setVisible(true);
                p.body.checkCollision.none = false;
                p.refreshBody();
            }
        });

        this.carrots.children.each(c => {
            if (c.y > DEACT_Y && c.active) {
                c.setActive(false).setVisible(false);
            } else if (c.y <= REACT_Y && !c.active) {
                c.setActive(true).setVisible(true);
                c.refreshBody?.();
            }
        });
    }

    positionMoon() {
        if (!this.moon) return;
        const cam = this.cameras.main;
        const w = this.scale.width;
        const h = this.scale.height;
        const sf = 0.05; // same as moon scrollFactor
        const Sx = w * 0.75;  // 75% across
        const Sy = h * 0.15;  // 15% down (higher)
        this.moon.setPosition(cam.scrollX * sf + Sx, cam.scrollY * sf + Sy);
    }

    positionOctopus() {
        if (!this.octopus) return;
        const cam = this.cameras.main;
        const w = this.scale.width, h = this.scale.height, sf = 0.05;
        const Sx = w * 0.25,    // 25% across
              Sy = h * 0.15;    // 15% down (same as moon)
        this.octopus.setPosition(cam.scrollX * sf + Sx, cam.scrollY * sf + Sy);
    }

    updateDeepSpaceLayers(time, delta) {
        if (!this.deepSpaceLayers) return;
        
        const cam = this.cameras.main;
        
        // Update each simplified layer with its specific parallax and animations
        this.deepSpaceLayers.forEach((layer, layerIndex) => {
            if (!layer || !layer.list) return;
            
            layer.list.forEach(element => {
                const sx = element.getData('sx');
                const sy = element.getData('sy');
                if (sx === undefined || sy === undefined) return;
                
                // Get the scroll factor for this layer
                const sf = layer.scrollFactorX || 0.05;
                
                // Base position with parallax
                let newX = cam.scrollX * sf + sx;
                let newY = cam.scrollY * sf + sy;
                
                // Layer-specific animations (simplified)
                switch (layerIndex) {
                    case 2: // Asteroid layer - rotation and gentle drift
                        const rotSpeed = element.getData('rotSpeed') || 0;
                        const driftSpeed = element.getData('driftSpeed') || 0;
                        element.rotation += rotSpeed;
                        // Very subtle drift motion
                        const driftX = Math.sin(time * 0.0001 + element.y) * driftSpeed;
                        const driftY = Math.cos(time * 0.0001 + element.x) * driftSpeed * 0.3;
                        newX += driftX;
                        newY += driftY;
                        break;
                }
                
                element.setPosition(newX, newY);
            });
        });
    }

    updateBackground() {
        const h = Math.max(0, Math.floor((this.groundLevel - this.groundOffset - this.player.y) / 10));

        // First transition: city -> night sky
        const t1Start = 50, t1End = 100;
        let nightA = 0;
        if      (h <= t1Start)                      nightA = 0;
        else if (h >= t1End)                        nightA = 1;
        else                                        nightA = (h - t1Start) / (t1End - t1Start);

        // Second transition: night sky -> deep space
        const t2Start = 1400, t2End = 1900;  // fade over 500 m for smoother transition
        let spaceA = 0;
        if      (h <= t2Start)               spaceA = 0;
        else if (h >= t2End)                 spaceA = 1;
        else                                 spaceA = (h - t2Start) / (t2End - t2Start);

        // Apply background transitions
        this.cityscapeBackground.setAlpha(1 - nightA);
        this.nightskyBackground.setAlpha(nightA * (1 - spaceA));
        this.deepSpaceBackground.setAlpha(spaceA);

        // Moon fades in with night sky, then fades out as we enter deep space
        if (this.moon) this.moon.setAlpha(nightA * (1 - spaceA));
        
        // Octopus replaces moon in deep space (no tint, natural colors)
        if (this.octopus) {
            this.octopus.setAlpha(spaceA);
            // Remove tinting to keep natural octopus colors
        }

        // Simplified deep space layer management
        if (this.deepSpaceLayers) {
            // Smooth transition zones for the 3 essential layers
            const zones = [
                { start: 1200, end: 1500, intensity: 0.4 }, // Far background stars
                { start: 1400, end: 1700, intensity: 0.8 }, // Bright stars
                { start: 1500, end: 1800, intensity: 0.7 }  // Asteroids
            ];

            this.deepSpaceLayers.forEach((layer, index) => {
                if (!layer) return;
                
                const zone = zones[index] || zones[zones.length - 1];
                let layerAlpha = 0;
                
                if (h <= zone.start) {
                    layerAlpha = 0;
                } else if (h >= zone.end) {
                    layerAlpha = zone.intensity;
                } else {
                    const progress = (h - zone.start) / (zone.end - zone.start);
                    layerAlpha = progress * zone.intensity;
                }
                
                layer.setAlpha(layerAlpha);
                
                // Apply subtle tinting for a cohesive deep space feel
                if (layerAlpha > 0 && layer.list) {
                    const tintColors = [
                        0xE6F3FF, // Far stars - cool white
                        0xFFFFFF, // Bright stars - pure white  
                        0xD0D0D0  // Asteroids - soft gray
                    ];
                    
                    const tint = tintColors[index] || 0xFFFFFF;
                    layer.list.forEach(element => {
                        if (element.setTint) {
                            element.setTint(tint);
                        }
                    });
                }
            });
        }

        // Control shooting star system
        if (this.shootingStarTimer) {
            this.shootingStarTimer.paused = (spaceA < 0.5);
        }
    }

    shutdown() {
        // Stop background music to prevent overlap on restart
        if (this.bgMusicSource) {
            this.bgMusicSource.stop();
            this.bgMusicSource = null;
        }
        
        // Clean up shooting star timer
        if (this.shootingStarTimer) {
            this.shootingStarTimer.destroy();
        }
        
        // Clean up any remaining shooting stars
        if (this.shootingStars) {
            this.shootingStars.clear(true, true);
        }
    }

}

// Game configuration
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#1A1A2E',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
        mouse: {
            preventDefaultWheel: true
        }
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false  // Enable to visualize physics bodies
        }
    },
    scene: [TitleScene, GameScene],
    pixelArt: true,
    antialias: false
};

// Start the game
const game = new Phaser.Game(config);