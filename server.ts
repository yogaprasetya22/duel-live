import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
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

        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

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
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`TikTok-Game Server running on port ${PORT}`);
});
