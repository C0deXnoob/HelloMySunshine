const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

const roomHistory = {}; // Stores chat messages per room

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create Room
    socket.on('create-room', ({ room, identity }) => {
        socket.join(room);
        socket.room = room;
        socket.identity = identity;
        if (!roomHistory[room]) roomHistory[room] = [];

        io.to(room).emit('chat-history', roomHistory[room]);
        updateViewerCount(room);
    });

    // Join Room
    socket.on('join-room', ({ room, identity }) => {
        socket.join(room);
        socket.room = room;
        socket.identity = identity;
        if (!roomHistory[room]) roomHistory[room] = [];

        // Notify host that a new viewer joined so WebRTC stream can be negotiated
        socket.to(room).emit('viewer-joined', { viewerId: socket.id });
        io.to(room).emit('chat-history', roomHistory[room]);
        updateViewerCount(room);
    });

    // WebRTC Signaling (Offers, Answers, Candidates)
    socket.on('offer', ({ target, offer }) => {
        io.to(target).emit('offer', { offer, callerId: socket.id });
    });

    socket.on('answer', ({ target, answer }) => {
        io.to(target).emit('answer', { answer, callerId: socket.id });
    });

    socket.on('ice-candidate', ({ target, candidate }) => {
        io.to(target).emit('ice-candidate', { candidate, callerId: socket.id });
    });

    // Chat Messaging
    socket.on('send-chat-message', ({ room, sender, text }) => {
        const msg = { sender, text };
        if (!roomHistory[room]) roomHistory[room] = [];
        roomHistory[room].push(msg);

        // Keep last 100 messages in memory
        if (roomHistory[room].length > 100) roomHistory[room].shift();

        io.to(room).emit('chat-message', msg);
    });

    socket.on('disconnect', () => {
        if (socket.room) {
            updateViewerCount(socket.room);
        }
        console.log(`User disconnected: ${socket.id}`);
    });

    function updateViewerCount(room) {
        const clients = io.sockets.adapter.rooms.get(room);
        const count = clients ? clients.size : 0;
        io.to(room).emit('viewer-count-update', count);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
