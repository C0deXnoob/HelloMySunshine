const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'Sunshine Theater signaling server' });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

// One host + one viewer per room. Chat history is kept in memory.
const rooms = new Map();

function getRoom(room) {
    if (!rooms.has(room)) {
        rooms.set(room, {
            hostId: null,
            viewerId: null,
            history: []
        });
    }
    return rooms.get(room);
}

function viewerCount(roomData) {
    return (roomData.hostId ? 1 : 0) + (roomData.viewerId ? 1 : 0);
}

function emitCount(room, roomData) {
    io.to(room).emit('viewer-count-update', viewerCount(roomData));
}

io.on('connection', socket => {
    console.log('Connected:', socket.id);

    socket.on('create-room', ({ room, identity }) => {
        if (!room) return;
        const data = getRoom(room);

        if (data.hostId && data.hostId !== socket.id) {
            socket.emit('room-error', { message: 'This room already has a host.' });
            return;
        }

        socket.join(room);
        data.hostId = socket.id;
        socket.data.room = room;
        socket.data.role = 'host';
        socket.data.identity = identity;

        socket.emit('chat-history', data.history);
        socket.emit('host-ready');
        emitCount(room, data);

        // If the viewer arrived before the host, tell the host to start WebRTC.
        if (data.viewerId) {
            io.to(data.hostId).emit('viewer-joined');
        }

        console.log(`[ROOM ${room}] Host: ${socket.id}`);
    });

    socket.on('join-room', ({ room, identity }) => {
        if (!room) return;
        const data = getRoom(room);

        if (!data.hostId) {
            // Keep the viewer in the room so that the host can arrive later.
            socket.join(room);
            data.viewerId = socket.id;
            socket.data.room = room;
            socket.data.role = 'viewer';
            socket.data.identity = identity;
            socket.emit('chat-history', data.history);
            socket.emit('waiting-for-host');
            emitCount(room, data);
            console.log(`[ROOM ${room}] Viewer waiting: ${socket.id}`);
            return;
        }

        if (data.viewerId && data.viewerId !== socket.id) {
            socket.emit('room-error', { message: 'This room already has a viewer.' });
            return;
        }

        socket.join(room);
        data.viewerId = socket.id;
        socket.data.room = room;
        socket.data.role = 'viewer';
        socket.data.identity = identity;
        socket.emit('chat-history', data.history);
        emitCount(room, data);

        io.to(data.hostId).emit('viewer-joined');
        console.log(`[ROOM ${room}] Viewer: ${socket.id}`);
    });

    socket.on('signal', ({ room, signal }) => {
        const data = rooms.get(room);
        if (!data) return;

        const targetId = socket.id === data.hostId ? data.viewerId : data.hostId;
        if (targetId) {
            io.to(targetId).emit('signal', {
                signal,
                sender: socket.id
            });
        }
    });

    socket.on('send-chat-message', ({ room, sender, text }) => {
        if (!room || !text || !rooms.has(room)) return;
        const data = rooms.get(room);
        const msg = { sender, text: String(text).slice(0, 1000) };
        data.history.push(msg);
        if (data.history.length > 50) data.history.shift();
        io.to(room).emit('chat-message', msg);
    });

    socket.on('end-session', ({ room }) => {
        const data = rooms.get(room);
        if (!data) return;
        io.to(room).emit('session-ended');
        rooms.delete(room);
    });

    socket.on('disconnect', () => {
        const room = socket.data.room;
        if (!room || !rooms.has(room)) return;

        const data = rooms.get(room);
        if (data.hostId === socket.id) data.hostId = null;
        if (data.viewerId === socket.id) data.viewerId = null;

        emitCount(room, data);

        // If the viewer remains, tell them the host disconnected.
        if (!data.hostId && data.viewerId) {
            io.to(data.viewerId).emit('host-disconnected');
        }

        if (!data.hostId && !data.viewerId) {
            rooms.delete(room);
        }

        console.log('Disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunshine Theater signaling server running on port ${PORT}`);
});
