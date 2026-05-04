import { Player } from "./Player";

export class Renderer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get 2d context");
        this.ctx = ctx;
    }

    clear() {
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawArena(arenaX: number, arenaY: number, arenaW: number, arenaH: number) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#00FF41";
        ctx.lineWidth = 4;
        ctx.shadowColor = "#00FF41";
        ctx.shadowBlur = 10;
        ctx.strokeRect(arenaX, arenaY, arenaW, arenaH);
        ctx.shadowBlur = 0;
    }

    drawObstacle(body: Matter.Body) {
        const ctx = this.ctx;
        const { x, y } = body.position;
        const { min, max } = body.bounds;
        const w = max.x - min.x;
        const h = max.y - min.y;

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "#00FF41";
        ctx.shadowColor = "#00FF41";
        ctx.shadowBlur = 8;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
    }

    drawPlayer(player: Player) {
        const ctx = this.ctx;
        const r = player.radius;

        // ── 1. DRAW AVATAR (Circle Part) ──
        const circleBody = player.body.parts[1];
        const { x: cx, y: cy } = circleBody.position;
        const circleAngle = player.body.angle;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(circleAngle);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();

        if (player.avatarImg) {
            ctx.drawImage(player.avatarImg, -r, -r, r * 2, r * 2);
        }

        if (player.isHit) {
            ctx.fillStyle = "rgba(255, 30, 30, 0.45)";
            ctx.fillRect(-r, -r, r * 2, r * 2);
        }

        ctx.restore();

        // ── 2. DRAW BORDER ──
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = player.isHit ? "#FF0000" : "rgba(255,255,255,0.3)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // ── 3. DRAW KNIVES ──
        const knifeParts = player.body.parts.filter(p => p.label === 'player-knife');
        
        knifeParts.forEach((kPart, i) => {
            const { x: kx, y: ky } = kPart.position;
            const knifeAngle = player.body.angle;

            ctx.save();
            ctx.translate(kx, ky);
            const rotationOffset = (i === 0) ? Math.PI : 0;
            ctx.rotate(knifeAngle + rotationOffset);

            if (player.knifeImg) {
                const img = player.knifeImg;
                const targetH = 65;
                const targetW = (img.width / img.height) * targetH;
                ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
            } else {
                const kh = 55;
                ctx.fillStyle = "#aaaaaa";
                ctx.fillRect(-3, -kh / 2, 6, kh * 0.7);
                ctx.fillStyle = "#8B4513";
                ctx.fillRect(-5, kh * 0.2, 10, kh * 0.3);
            }
            ctx.restore();
        });

        // ── 4. DRAW HP LABEL (Always Upright in the center) ──
        ctx.save();
        ctx.translate(cx, cy);
        ctx.font = "bold 32px Arial"; 
        ctx.fillStyle = player.isHit ? "#FF0000" : "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle"; // Center vertically
        ctx.shadowColor = "black";
        ctx.shadowBlur = 8;
        ctx.fillText(Math.ceil(player.hp).toString(), 0, 0);
        ctx.restore();
    }

    drawHP(player: Player, x: number, y: number, color: string) {
        const ctx = this.ctx;
        ctx.font = "bold 28px Arial";
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(player.hp.toString(), x, y);
    }
}
