import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { WebcastPushConnection } from "tiktok-live-connector";
import path from "path";

const app = express();
const httpServer = createServer(app);

// Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, "dist")));

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

let tiktokConnection: WebcastPushConnection | null = null;

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-tiktok", (username: string) => {
        console.log(`Request to join TikTok: ${username}`);

        // Cleanup previous connection if any
        if (tiktokConnection) {
            tiktokConnection.disconnect();
            tiktokConnection = null;
        }

        // ── TESTING MODE ──
        if (username.toUpperCase() === "TEST") {
            console.log("Entering TESTING MODE...");
            socket.emit("tiktok-status", { connected: true, roomId: "TEST_ROOM" });

            const testInterval = setInterval(() => {
                const dummyId = `bot_${Math.floor(Math.random() * 50)}`;
                const isGift = Math.random() > 0.7;

                if (isGift) {
                    const diamonds = Math.floor(Math.random() * 5) + 1;
                    io.emit("tiktok-gift", {
                        uniqueId: dummyId,
                        giftName: "Rose",
                        repeatCount: 1,
                        diamondCount: diamonds,
                        profilePictureUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${dummyId}`,
                    });
                } else {
                    io.emit("tiktok-chat", {
                        uniqueId: dummyId,
                        comment: "CYBERPUNK BATTLE!",
                        nickname: `Bot ${dummyId}`,
                        profilePictureUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${dummyId}`,
                    });
                }

                // Simulate member join periodically
                if (Math.random() > 0.8) {
                    const newBotId = `bot_${Math.floor(Math.random() * 50 + 50)}`;
                    io.emit("tiktok-member", {
                        uniqueId: newBotId,
                        nickname: `Bot ${newBotId}`,
                        profilePictureUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${newBotId}`,
                    });
                }
            }, 600); // More frequent updates

            socket.on("disconnect", () => {
                clearInterval(testInterval);
                console.log("Testing Mode stopped.");
            });
            return;
        }

        // ── PRODUCTION MODE ──
        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection
            .connect()
            .then((state) => {
                console.log(`Connected to room ${state.roomId}`);
                socket.emit("tiktok-status", {
                    connected: true,
                    roomId: state.roomId,
                });
            })
            .catch((err) => {
                console.error("Failed to connect", err);
                socket.emit("tiktok-status", {
                    connected: false,
                    error: err.message,
                });
            });

        // Event Forwarding
        tiktokConnection.on("chat", (data) => {
            io.emit("tiktok-chat", {
                uniqueId: data.uniqueId,
                comment: data.comment,
                nickname: data.nickname,
                profilePictureUrl: data.profilePictureUrl,
            });
        });

        tiktokConnection.on("gift", (data) => {
            io.emit("tiktok-gift", {
                uniqueId: data.uniqueId,
                giftName: data.giftName,
                repeatCount: data.repeatCount,
                diamondCount: data.diamondCount,
                profilePictureUrl: data.profilePictureUrl,
            });
        });

        tiktokConnection.on("like", (data) => {
            io.emit("tiktok-like", {
                uniqueId: data.uniqueId,
                likeCount: data.likeCount,
                totalLikeCount: data.totalLikeCount,
            });
        });

        tiktokConnection.on("follow", (data) => {
            io.emit("tiktok-follow", {
                uniqueId: data.uniqueId,
            });
        });

        tiktokConnection.on("share", (data) => {
            io.emit("tiktok-share", {
                uniqueId: data.uniqueId,
            });
        });

        tiktokConnection.on("member", (data) => {
            io.emit("tiktok-member", {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                profilePictureUrl: data.profilePictureUrl,
            });
        });
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        
        // If this socket started the tiktok connection, clean it up
        if (tiktokConnection) {
            console.log("Stopping TikTok connection due to client disconnect...");
            tiktokConnection.disconnect();
            tiktokConnection = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`TikTok-Game Server running on port ${PORT}`);
});
