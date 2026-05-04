import { Game } from './Game';
import { io } from 'socket.io-client';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const statusText = document.getElementById('status') as HTMLSpanElement;
const connectorDiv = document.getElementById('connector') as HTMLDivElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

if (canvas) {
  closeBtn?.addEventListener('click', () => {
    connectorDiv.style.display = 'none';
  });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const game = new Game(canvas);

  const socket = io('http://localhost:3000');

  connectBtn.addEventListener('click', () => {
    game.reset(); // Clear everything for a fresh start
    game.startMusic();
    const user = usernameInput.value.trim();
    if (user) {
      statusText.innerText = 'Connecting...';
      socket.emit('join-tiktok', user);
    }
  });

  socket.on('tiktok-status', (data) => {
    if (data.connected) {
      statusText.innerText = 'Connected to Live!';
      statusText.style.color = '#00ff41';
      setTimeout(() => {
        connectorDiv.style.display = 'none';
      }, 2000);
    } else {
      statusText.innerText = 'Failed: ' + (data.error || 'Unknown error');
      statusText.style.color = '#ff4444';
    }
  });

  // Forward events to game
  socket.on('tiktok-chat', (data) => game.onTikTokChat(data));
  socket.on('tiktok-gift', (data) => game.onTikTokGift(data));
  socket.on('tiktok-like', (data) => game.onTikTokLike(data));
}
