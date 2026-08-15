const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('create-room', (room) => {
        socket.join(room);
        socket.role = 'host';
        socket.room = room;
        updateViewerCount(room);
    });

    socket.on('join-room', (room) => {
        const roomAdapter = io.sockets.adapter.rooms.get(room);
        if (!roomAdapter) {
            return socket.emit('error-msg', 'Room does not exist. Ask host to start movie first!');
        }
        
        socket.join(room);
        socket.role = 'viewer';
        socket.room = room;

        socket.to(room).emit('viewer-joined', { viewerId: socket.id });
        updateViewerCount(room);
    });

    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { offer: data.offer, callerId: socket.id });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { answer: data.answer, callerId: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, callerId: socket.id });
    });

    socket.on('disconnecting', () => {
        if (socket.room) {
            const room = socket.room;
            socket.to(room).emit('viewer-left', { viewerId: socket.id });
            setTimeout(() => updateViewerCount(room), 100);
        }
    });
});

function updateViewerCount(room) {
    const clients = io.sockets.adapter.rooms.get(room);
    // Count viewers (total connected in room minus 1 host)
    const count = clients ? Math.max(0, clients.size - 1) : 0;
    io.to(room).emit('viewer-count-update', count);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Movie Theater Server running on port ${PORT}`));
