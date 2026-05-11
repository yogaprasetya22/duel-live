import React, { useEffect, useState } from 'react';
import { Trophy, Users, ArrowRight, Crown } from 'lucide-react';

interface PlayerData {
    id: string;
    hp: number;
    avatar?: string;
}

interface WinnerData {
    name: string;
    avatarUrl: string | null;
}

interface HUDProps {
    game: any;
}

export const HUD: React.FC<HUDProps> = ({ game }) => {
    const [leaderboard, setLeaderboard] = useState<PlayerData[]>([]);
    const [queue, setQueue] = useState<string[]>([]);
    const [victoryTimer, setVictoryTimer] = useState(0);
    const [winnersHistory, setWinnersHistory] = useState<WinnerData[]>([]);
    const [gameState, setGameState] = useState("playing");
    const [winnerName, setWinnerName] = useState<string | null>(null);

    useEffect(() => {
        const updateInterval = setInterval(() => {
            if (!game) return;

            // Update Leaderboard
            const topPlayers = [...game.players]
                .sort((a, b) => b.hp - a.hp)
                .slice(0, 5)
                .map(p => ({
                    id: p.id,
                    hp: p.hp,
                    avatar: p.avatarImg?.src
                }));
            setLeaderboard(topPlayers);

            // Update Queue
            setQueue(game.queue.map((q: any) => q.name));

            // Update Timer
            setVictoryTimer(Math.max(0, Math.ceil(game.victoryTimer / 1000)));

            // Update Winners History
            setWinnersHistory([...game.winnersHistory]);

            // Update Game State
            setGameState(game.state);
            setWinnerName(game.winner);
        }, 250); // Reduced frequency for better performance

        return () => clearInterval(updateInterval);
    }, [game]);

    return (
        <div className="hud-root-container">
            {/* Top Bar: Hall of Fame (Ultra Premium) */}
            <div className="hud-top-bar">
                <div className="top-bar-header">
                    <span>HALL OF FAME</span>
                    <div className="sub-text">PREVIOUS CHAMPIONS</div>
                </div>
                <div className="top-winners-row">
                    {winnersHistory.length > 0 ? (
                        winnersHistory.map((winner, i) => (
                            <div key={`${winner.name}-${i}`} className="top-winner-item animate-slide-right">
                                <div className="winner-avatar-small">
                                    {winner.avatarUrl ? <img src={winner.avatarUrl} alt="" /> : "👑"}
                                </div>
                                <span className="winner-name-small">{winner.name?.toUpperCase() || "CHAMPION"}</span>
                            </div>
                        ))
                    ) : (
                        <div className="no-winners">WAITING FOR CHAMPIONS...</div>
                    )}
                </div>
                <div className="top-timer">
                    <div className="timer-label">TIME REMAINING</div>
                    <div className="timer-clock">{victoryTimer}s</div>
                </div>
            </div>

            {/* Sidebar: Leaderboard & Queue */}
            <div className="hud-sidebar-right">
                {/* Leaderboard Section */}
                <div className="luxury-card">
                    <div className="section-header">
                        <Trophy className="icon-gold" size={24} />
                        <h2>LEADERBOARD</h2>
                    </div>
                    
                    <div className="lb-list">
                        {leaderboard.map((player, i) => (
                            <div key={player.id} className={`lb-row rank-${i + 1}`}>
                                <div className="rank-badge">
                                    {i === 0 ? "01" : i === 1 ? "02" : i === 2 ? "03" : `0${i + 1}`}
                                </div>
                                <div className="avatar-wrapper">
                                    {player.avatar ? (
                                        <img src={player.avatar} alt="" />
                                    ) : (
                                        <div className="avatar-placeholder"><Users size={16} /></div>
                                    )}
                                </div>
                                <div className="player-info">
                                    <span className="player-name">{player.id?.toUpperCase() || "PLAYER"}</span>
                                    <div className="hp-bar-container">
                                        <div 
                                            className="hp-bar-fill" 
                                            style={{ width: `${Math.min(100, (player.hp / 100) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Waiting List Section */}
                <div className="luxury-card">
                    <div className="section-header">
                        <Users className="icon-blue" size={24} />
                        <h2>WAITING LIST</h2>
                    </div>
                    <div className="queue-list-small">
                        {queue.slice(0, 10).map((name, i) => (
                            <div key={`${name}-${i}`} className="queue-row-small animate-slide-right">
                                <ArrowRight size={14} className="icon-dim" />
                                <span>{name?.toUpperCase() || "..."}</span>
                            </div>
                        ))}
                        {queue.length === 0 && <div className="queue-empty">NO PLAYERS IN QUEUE</div>}
                    </div>
                </div>
            </div>

            {/* Victory Overlay - Ultra Premium Cinematic */}
            {gameState === "gameover" && (
                <div className="victory-overlay">
                    <div className="victory-content animate-pop">
                        <Crown className="victory-crown" size={100} />
                        <h1 className="victory-title">VICTORY</h1>
                        <div className="winner-display">
                            <h2 className="winner-id">{winnerName?.toUpperCase()}</h2>
                        </div>
                        <div className="restart-countdown">
                            PREPARING NEXT MATCH...
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
