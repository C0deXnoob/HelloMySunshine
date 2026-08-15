const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('join', (room) => {
        socket.join(room);
        const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);

        // Limit to 3 total devices (1 PC Broadcaster + 2 Viewers)
        if (clients.length > 3) {
            socket.emit('room-full');
            socket.leave(room);
            return;
        }

        socket.to(room).emit('user-joined', { callerId: socket.id });
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
        socket.rooms.forEach((room) => {
            socket.to(room).emit('user-left', { callerId: socket.id });
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Screen Streamer running on port ${PORT}`));
