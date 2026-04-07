import { _decorator, Component, Node, MeshRenderer, Material, Vec3, Enum, ParticleSystem, Prefab, instantiate, Color } from 'cc';
import { Snake } from './Snake';

const { ccclass, property } = _decorator;

@ccclass('ColorMaterialMapping')
class ColorMaterialMapping {
    @property({ tooltip: 'The color name matching snake.snakeColor (e.g. green, blue)' })
    colorName: string = 'green';
    @property({ type: Material })
    material: Material = null;
}

@ccclass('Hole')
export class Hole extends Component {

    @property(MeshRenderer)
    holeRimRenderer: MeshRenderer = null;

    @property(MeshRenderer)
    nextIndicatorRenderer: MeshRenderer = null;

    @property({ type: [ColorMaterialMapping], tooltip: 'Materials to cycle through' })
    colorMappings: ColorMaterialMapping[] = [];

    // ── FIX 2: A dedicated "empty / black" material shown when no next snake exists ──
    @property({ type: Material, tooltip: 'Material shown on the next-indicator when no candidates remain (should be black/dark)' })
    emptyIndicatorMaterial: Material = null;

    @property({ tooltip: 'How close the snake head must be to enter the hole' })
    detectionRadius: number = 0.8;

    @property({ type: Prefab, tooltip: 'Particle effect prefab to spawn when a snake enters this hole' })
    entryParticlePrefab: Prefab = null;

    @property({ tooltip: 'How long (seconds) to keep the particle effect alive before destroying it' })
    particlePlayTime: number = 2.0;

    @property({ tooltip: 'Y offset above the hole to spawn the particle effect' })
    particleYOffset: number = 0.5;

    @property
    randomizeNextColor: boolean = true;

    @property({ tooltip: 'How often (seconds) to re-evaluate the best snake color' })
    evaluationInterval: number = 1.0;

    private _evalTimer: number = 0;
    private _currentIndex: number = 0;
    private _nextIndex: number = -1;   // -1 = no next candidate (show empty/black)

    start() {
        if (this.colorMappings.length >= 2) {
            const greyIdx = this.colorMappings.findIndex(
                m => m.colorName.toLowerCase().trim() === 'grey'
            );
            this._currentIndex = greyIdx !== -1 ? greyIdx : 0;
            this._nextIndex    = -1;
            this.updateMaterials();

            this.scheduleOnce(() => {
                this._nextIndex = this.getBestCandidateIndex();
                this.updateMaterials();
            }, 0);
        } else {
            console.warn(`[Hole] ${this.node.name} needs at least 2 ColorMaterialMappings assigned in Inspector.`);
        }
    }

    // ── FIX 2: updateMaterials uses emptyIndicatorMaterial when _nextIndex === -1 ──
    updateMaterials() {
        if (this.holeRimRenderer && this.colorMappings[this._currentIndex]?.material) {
            this.holeRimRenderer.setMaterial(this.colorMappings[this._currentIndex].material, 0);
        }

        if (this.nextIndicatorRenderer) {
            if (this._nextIndex === -1) {
                // No remaining candidates — show black/empty material
                if (this.emptyIndicatorMaterial) {
                    this.nextIndicatorRenderer.setMaterial(this.emptyIndicatorMaterial, 0);
                }
                // If no emptyIndicatorMaterial is assigned, leave whatever is there.
            } else if (this.colorMappings[this._nextIndex]?.material) {
                this.nextIndicatorRenderer.setMaterial(this.colorMappings[this._nextIndex].material, 0);
            }
        }
    }

    advanceColor() {
        if (this.colorMappings.length < 2) return;

        if (this._nextIndex !== -1) {
            this._currentIndex = this._nextIndex;
        }

        // Re-evaluate best next candidate after advancing
        this._nextIndex = this.getBestCandidateIndex();
        this.updateMaterials();
    }

    // ── FIX 2: returns -1 when no valid candidate exists (single snake left or none) ──
    private getBestCandidateIndex(): number {
        const snakes = this.node.scene.getComponentsInChildren(Snake);
        const holePos = this.node.getWorldPosition();

        const candidates: { colorIndex: number; color: string; score: number }[] = [];

        for (const snake of snakes) {
            if (snake.isEnteringHole())  continue;
            if (snake.hasFailed())       continue;
            if (snake.isMovingNow())     continue;
            if (snake.isLocked())        continue;

            const headNode = snake.getHeadNode();
            if (!headNode) continue;

            const snakeCol = snake.snakeColor.toLowerCase().trim();
            const mappingIdx = this.colorMappings.findIndex(
                m => m.colorName.toLowerCase().trim() === snakeCol
            );
            if (mappingIdx === -1) continue;
            // Don't show the current hole color as "next" unless it's the only option
            if (mappingIdx === this._currentIndex) continue;

            let score = 0;
            const dist = Vec3.distance(headNode.getWorldPosition(), holePos);
            score += dist * 1.0;
            if (snake.isFrontBlocked()) score += 50;
            if (snake.isLocked())       score += 100;

            candidates.push({ colorIndex: mappingIdx, color: snakeCol, score });
        }

        // ── FIX 2: no candidates at all → return -1 (show black) ──────────────
        if (candidates.length === 0) {
            // Fallback: find any snake color that still exists (even if moving/locked)
            for (const snake of snakes) {
                if (snake.hasFailed()) continue;
                if (snake.isEnteringHole()) continue;
                if (snake.isEntryFinished()) continue;
                const snakeCol = snake.snakeColor.toLowerCase().trim();
                const hasMapping = this.colorMappings.some(
                    m => m.colorName.toLowerCase().trim() === snakeCol
                );
                if (hasMapping) return this.colorMappings.findIndex(
                    m => m.colorName.toLowerCase().trim() === snakeCol
                );
            }
            return this._currentIndex;
        }

        candidates.sort((a, b) => a.score - b.score);

        const topN = Math.min(3, candidates.length);
        const top  = candidates.slice(0, topN);

        const freq: Record<number, number> = {};
        for (const c of top) freq[c.colorIndex] = (freq[c.colorIndex] ?? 0) + 1;

        let bestIdx  = top[0].colorIndex;
        let bestFreq = 0;
        for (const idxStr of Object.keys(freq)) {
            const idx   = Number(idxStr);
            const count = freq[idx];
            if (count > bestFreq) { bestFreq = count; bestIdx = idx; }
        }

        return bestIdx;
    }

    /** @deprecated Use getBestCandidateIndex internally; kept for external callers. */
    private getBestCandidateColor(): string {
        const idx = this.getBestCandidateIndex();
        if (idx === -1) return '';
        return this.colorMappings[idx]?.colorName?.toLowerCase().trim() ?? '';
    }

    getCurrentColorName(): string {
        const mapping = this.colorMappings[this._currentIndex];
        return mapping ? mapping.colorName.toLowerCase().trim() : "";
    }

    private _getActiveSnakes(allSnakes: Snake[]): Snake[] {
        return allSnakes.filter(s => !s.hasFailed() && !s.isEnteringHole() && !s.isEntryFinished());
    }

    private _forceCurrentColorToSnake(snake: Snake): void {
        const snakeCol = snake.snakeColor.toLowerCase().trim();
        const idx = this.colorMappings.findIndex(
            m => m.colorName.toLowerCase().trim() === snakeCol
        );
        if (idx === -1) return;
        if (this._currentIndex === idx && this._nextIndex === -1) return;
        this._currentIndex = idx;
        this._nextIndex = -1;
        this.updateMaterials();
    }

    private _emitSceneEvent(eventName: string, snake: Snake): void {
        let n: Node = this.node;
        while (n.parent) {
            n = n.parent;
            n.emit(eventName, { snake, hole: this });
        }
    }

    update(dt: number) {
        const snakes = this.node.scene.getComponentsInChildren(Snake);
        const activeSnakes = this._getActiveSnakes(snakes);

        if (activeSnakes.length === 1) {
            this._forceCurrentColorToSnake(activeSnakes[0]);
        } else if (activeSnakes.length === 2) {
            const targetColor = this.getCurrentColorName();
            const anyMatch = activeSnakes.some(s => {
                const c = s.snakeColor.toLowerCase().trim();
                return c === targetColor || targetColor.includes(c) || c.includes(targetColor);
            });
            if (!anyMatch) {
                this._forceCurrentColorToSnake(activeSnakes[0]);
            }
        }

        // ── Periodic next-color re-evaluation (only while not yet locked) ──
        if (activeSnakes.length > 1 && this._nextIndex === -1) {
            this._evalTimer += dt;
            if (this._evalTimer >= this.evaluationInterval) {
                this._evalTimer = 0;
                const bestIdx = this.getBestCandidateIndex();
                if (bestIdx !== this._nextIndex) {
                    this._nextIndex = bestIdx;
                    this.updateMaterials();
                }
            }
        }

        // ── Hole detection logic ─────────────────────────────────────────────
        const holePos   = this.node.getWorldPosition();
        const targetColor = this.getCurrentColorName();
        if (targetColor === '') return;

        for (const snake of snakes) {
            if (snake.isEnteringHole()) continue;
            const headNode = snake.getHeadNode();
            if (!headNode) continue;

            const diff = new Vec3();
            Vec3.subtract(diff, holePos, headNode.getWorldPosition());
            diff.y = 0;
            if (diff.length() >= this.detectionRadius) continue;

            const snakeCol = snake.snakeColor.toLowerCase().trim();
            const isMatch  = snakeCol === targetColor
                || targetColor.includes(snakeCol)
                || snakeCol.includes(targetColor);

            if (!isMatch) continue;

            console.log(`[Hole] Match! ${snakeCol} entering ${this.node.name}`);
            this._emitSceneEvent('sfx-snake-enter-hole', snake);

            if (this.entryParticlePrefab) {
                const fx      = instantiate(this.entryParticlePrefab);
                const spawnPos = holePos.clone();
                spawnPos.y    += this.particleYOffset;
                fx.setWorldPosition(spawnPos);
                fx.setParent(this.node.scene);
                const ps = fx.getComponent(ParticleSystem)
                        ?? fx.getComponentInChildren(ParticleSystem);
                if (ps) { ps.loop = true; ps.stop(); ps.play(); }
                this.scheduleOnce(() => {
                    if (!fx?.isValid) return;
                    const ps2 = fx.getComponent(ParticleSystem)
                              ?? fx.getComponentInChildren(ParticleSystem);
                    ps2?.stop();
                    this.scheduleOnce(() => { if (fx?.isValid) fx.destroy(); }, 1.0);
                }, this.particlePlayTime);
            }

            snake.enterHole(holePos, () => {
                this.advanceColor();
                console.log(`[Hole] ${this.node.name} color updated after snake fully entered.`);
            });
        }
    }
}