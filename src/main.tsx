import { Game } from "./Game";
import { io } from "socket.io-client";
import { createRoot } from 'react-dom/client';
import { HUD } from './HUD';
import "./style.css";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const testBtn = document.getElementById("test-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const statusText = document.getElementById("status") as HTMLSpanElement;
const statusDot = document.getElementById("status-dot") as HTMLDivElement;
const connectorPanel = document.getElementById("connector") as HTMLDivElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;

if (canvas) {
    const game = new Game(canvas);

    // React HUD
    const hudContainer = document.createElement('div');
    hudContainer.id = 'react-hud-root';
    document.body.appendChild(hudContainer);
    const root = createRoot(hudContainer);
    root.render(<HUD game={game} />);

    // Socket Connection
    // Menggunakan hostname dinamis agar bisa diakses dari HP di jaringan yang sama
    const socket = io(`${window.location.protocol}//${window.location.hostname}:3000`);

    const join = (username: string) => {
        if (!username) return;
        game.reset(); // Clear current game state
        statusText.innerText = "Connecting...";
        socket.emit("join-tiktok", username);
    };

    connectBtn.addEventListener("click", () => join(usernameInput.value.trim()));
    testBtn?.addEventListener("click", () => join("TEST"));
    
    if (disconnectBtn) {
        disconnectBtn.addEventListener("click", () => {
            socket.emit("leave-tiktok");
        });
    }

    closeBtn?.addEventListener("click", () => {
        connectorPanel.classList.add("hidden");
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || e.key === "h" || e.key === "H") {
            connectorPanel.classList.toggle("hidden");
        }
        if (e.key === "p" || e.key === "P") {
            game.downloadPerfLog();
        }
    });

    socket.on("tiktok-status", (data) => {
        if (data.connected) {
            statusText.innerText = "Connected to Live!";
            statusText.style.color = "#00ff41";
            statusDot.classList.add("online");
            setTimeout(() => connectorPanel.classList.add("hidden"), 2000);
            
            if (connectBtn) connectBtn.style.display = "none";
            if (disconnectBtn) disconnectBtn.style.display = "block";
        } else {
            statusText.innerText = "Failed: " + (data.error || "Unknown");
            statusText.style.color = "#ff4444";
            statusDot.classList.remove("online");
            
            if (connectBtn) connectBtn.style.display = "block";
            if (disconnectBtn) disconnectBtn.style.display = "none";
        }
    });

    socket.on("tiktok-chat", (data) => game.onTikTokChat(data));
    socket.on("tiktok-gift", (data) => game.onTikTokGift(data));
    socket.on("tiktok-like", (data) => game.onTikTokLike(data));
    socket.on("tiktok-member", (data) => game.onTikTokMember(data));
}
