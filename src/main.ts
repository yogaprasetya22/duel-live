import { Game } from './Game';
import { io } from 'socket.io-client';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const testBtn = document.getElementById('test-btn') as HTMLButtonElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const statusText = document.getElementById('status') as HTMLSpanElement;
const statusDot = document.getElementById('status-dot') as HTMLDivElement;
const connectorDiv = document.getElementById('connector') as HTMLDivElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

if (canvas) {
  closeBtn?.addEventListener('click', () => {
    connectorDiv.classList.add('hidden');
  });

  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') {
      connectorDiv.classList.toggle('hidden');
    }
    if (e.key === 'p' || e.key === 'P') {
      game.downloadPerfLog();
    }
  });

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const game = new Game(canvas);

  const socket = io('http://localhost:3000');

  const initiateConnection = (username: string) => {
    if (!username) return;
    game.reset(); 
    game.startMusic();
    statusText.innerText = 'Connecting...';
    socket.emit('join-tiktok', username);
  };

  connectBtn.addEventListener('click', () => {
    initiateConnection(usernameInput.value.trim());
  });

  testBtn?.addEventListener('click', () => {
    initiateConnection('TEST');
  });

  socket.on('tiktok-status', (data) => {
    if (data.connected) {
      statusText.innerText = 'Connected to Live!';
      statusText.style.color = '#00ff41';
      statusDot.classList.add('online');
      
      setTimeout(() => {
        connectorDiv.classList.add('hidden');
      }, 2000);
    } else {
      statusText.innerText = 'Failed: ' + (data.error || 'Unknown error');
      statusText.style.color = '#ff4444';
      statusDot.classList.remove('online');
    }
  });

  // Forward events to game
  socket.on('tiktok-chat', (data) => game.onTikTokChat(data));
  socket.on('tiktok-gift', (data) => game.onTikTokGift(data));
  socket.on('tiktok-like', (data) => game.onTikTokLike(data));
  socket.on('tiktok-member', (data) => game.onTikTokMember(data));
}
