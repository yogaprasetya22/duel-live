/**
 * BRUTAL SPATIAL HASH GRID
 * Optimized for: Zero GC, CPU Cache Friendliness, and 10k+ Entities.
 */
export class SpatialHash {
    private readonly cellSize: number;
    private readonly cols: number;
    private readonly rows: number;
    private readonly totalCells: number;

    // Buffer utama untuk menyimpan ID entitas secara linear
    // Kita alokasikan 128 slot per sel (sesuaikan dengan densitas unit)
    private readonly entityBuffer: Int32Array;
    private readonly cellCounts: Uint32Array;
    private readonly maxEntitiesPerCell: number = 128; 

    constructor(width: number, height: number, cellSize: number) {
        this.cellSize = cellSize;
        this.cols = Math.ceil(width / cellSize);
        this.rows = Math.ceil(height / cellSize);
        this.totalCells = this.cols * this.rows;

        // Flat buffer: [Cell0_Ent0, Cell0_Ent1, ..., Cell1_Ent0, ...]
        this.entityBuffer = new Int32Array(this.totalCells * this.maxEntitiesPerCell);
        this.cellCounts = new Uint32Array(this.totalCells);
        
        console.log(`[SpatialHash] Initialized: ${this.totalCells} cells (${this.cols}x${this.rows}), Buffer: ${(this.entityBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
    }

    /**
     * Reset pointer sel tanpa menghapus isi buffer (O(C))
     */
    public clear(): void {
        this.cellCounts.fill(0);
    }

    /**
     * Masukkan entitas ke dalam grid berdasarkan posisi.
     * @param id Entity ID or Index
     */
    public insert(id: number, x: number, y: number): void {
        const col = (x / this.cellSize) | 0;
        const row = (y / this.cellSize) | 0;

        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

        const cellIndex = col + row * this.cols;
        const count = this.cellCounts[cellIndex];

        if (count < this.maxEntitiesPerCell) {
            // Kalkulasi offset manual: cellIndex * stride + currentCount
            const offset = (cellIndex << 7) + count; // << 7 sama dengan * 128
            this.entityBuffer[offset] = id;
            this.cellCounts[cellIndex]++;
        }
    }

    /**
     * Query entitas di sel sekitar.
     * outResult harus berupa Array atau TypedArray yang sudah disediakan.
     */
    public query(x: number, y: number, radius: number, outResult: number[] | Int32Array): number {
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
                const startOffset = cellIndex << 7;

                for (let i = 0; i < count; i++) {
                    outResult[found++] = this.entityBuffer[startOffset + i];
                    if (found >= outResult.length) return found;
                }
            }
        }
        return found;
    }
}
