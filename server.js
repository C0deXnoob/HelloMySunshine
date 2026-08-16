const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static assets out of the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root request from inside 'public'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

io.on('connection', (socket) => {
    
    // Create Room (Host)
    socket.on('create-room', ({ room, identity }) => {
        socket.join(room);
        rooms[room] = rooms[room] || { viewers: 0, history: [] };
        rooms[room].viewers += 1;
        
        io.to(room).emit('viewer-count-update', rooms[room].viewers);
        socket.emit('chat-history', rooms[room].history);
    });

    // Join Room (Viewer)
    socket.on('join-room', ({ room, identity }) => {
        socket.join(room);
        rooms[room] = rooms[room] || { viewers: 0, history: [] };
        rooms[room].viewers += 1;

        io.to(room).emit('viewer-count-update', rooms[room].viewers);
        socket.emit('chat-history', rooms[room].history);
    });

    // WebRTC Signaling Relay
    socket.on('signal', (data) => {
        socket.to(data.room).emit('signal', {
            signal: data.signal,
            sender: socket.id
        });
    });

    // Live Chat Handler
    socket.on('send-chat-message', ({ room, sender, text }) => {
        const msg = { sender, text };
        if (rooms[room]) {
            rooms[room].history.push(msg);
            if (rooms[room].history.length > 50) rooms[room].history.shift();
        }
        io.to(room).emit('chat-message', msg);
    });

    // End Session Handler
    socket.on('end-session', ({ room }) => {
        io.to(room).emit('session-ended');
        delete rooms[room];
    });

    // Disconnect Handler
    socket.on('disconnecting', () => {
        socket.rooms.forEach(room => {
            if (rooms[room]) {
                rooms[room].viewers = Math.max(0, rooms[room].viewers - 1);
                io.to(room).emit('viewer-count-update', rooms[room].viewers);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
