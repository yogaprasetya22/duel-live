
/**
 * BRUTAL SPATIAL HASH
 * Optimized for Zero-GC and CPU Cache Coherence.
 */
export class SpatialHash {
    private cellSize: number;
    private cols: number;
    private rows: number;
    private totalCells: number;

    // Buffer utama: [Cell0_Ent0, Cell0_Ent1, ..., Cell0_Ent127, Cell1_Ent0, ...]
    // Kita kunci di 128 entitas per sel untuk optimasi bitwise (shift 7)
    private entityBuffer: Uint32Array;
    private cellCounts: Uint32Array;
    private readonly strideShift = 7; // 2^7 = 128

    constructor(width: number, height: number, cellSize: number) {
        this.cellSize = cellSize;
        this.cols = Math.ceil(width / cellSize);
        this.rows = Math.ceil(height / cellSize);
        this.totalCells = this.cols * this.rows;

        this.entityBuffer = new Uint32Array(this.totalCells << this.strideShift);
        this.cellCounts = new Uint32Array(this.totalCells);
        
        console.log(`[SpatialHash] Buffer Initialized: ${(this.entityBuffer.byteLength / 1024).toFixed(2)} KB`);
    }

    public clear(): void {
        this.cellCounts.fill(0);
    }

    public insert(id: number, x: number, y: number): void {
        const col = (x / this.cellSize) | 0;
        const row = (y / this.cellSize) | 0;

        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

        const cellIndex = col + row * this.cols;
        const count = this.cellCounts[cellIndex];

        if (count < 128) {
            const offset = (cellIndex << this.strideShift) + count;
            this.entityBuffer[offset] = id;
            this.cellCounts[cellIndex]++;
        }
    }

    public query(x: number, y: number, radius: number, outIds: Uint32Array): number {
        let found = 0;
        const xMin = ((x - radius) / this.cellSize) | 0;
        const xMax = ((x + radius) / this.cellSize) | 0;
        const yMin = ((y - radius) / this.cellSize) | 0;
        const yMax = ((y + radius) / this.cellSize) | 0;

        for (let r = yMin; r <= yMax; r++) {
            if (r < 0 || r >= this.rows) continue;
            const rowOffset = r * this.cols;

            for (let c = xMin; c <= xMax; c++) {
                if (c < 0 || c >= this.cols) continue;

                const cellIndex = c + rowOffset;
                const count = this.cellCounts[cellIndex];
                const startOffset = cellIndex << this.strideShift;

                for (let i = 0; i < count; i++) {
                    outIds[found++] = this.entityBuffer[startOffset + i];
                    if (found >= outIds.length) return found;
                }
            }
        }
        return found;
    }
}
