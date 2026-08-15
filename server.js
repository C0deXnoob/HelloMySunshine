const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('join', (room) => {
        const roomClients = io.sockets.adapter.rooms.get(room);
        const numClients = roomClients ? roomClients.size : 0;

        if (numClients === 0) {
            socket.join(room);
        } else if (numClients === 1) {
            socket.join(room);
            socket.to(room).emit('user-connected', socket.id);
        } else {
            socket.emit('room-full');
        }
    });

    socket.on('offer', (data) => socket.to(data.room).emit('offer', data));
    socket.on('answer', (data) => socket.to(data.room).emit('answer', data));
    socket.on('ice-candidate', (data) => socket.to(data.room).emit('ice-candidate', data.candidate));

    socket.on('disconnecting', () => {
        socket.rooms.forEach((room) => socket.to(room).emit('peer-left'));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`WebRTC Server running on http://localhost:${PORT}`));