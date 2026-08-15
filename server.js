const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static('public'));

// Store in-memory room sessions & chat history
const roomSessions = {};

io.on('connection', (socket) => {
    
    socket.on('create-room', ({ room, identity }) => {
        socket.join(room);
        if (!roomSessions[room]) {
            roomSessions[room] = { host: socket.id, chatHistory: [] };
        }
        socket.emit('chat-history', roomSessions[room].chatHistory);
    });

    socket.on('join-room', ({ room, identity }) => {
        socket.join(room);
        if (!roomSessions[room]) {
            roomSessions[room] = { host: null, chatHistory: [] };
        }
        
        // Broadcast join event to host for WebRTC peer creation
        if (roomSessions[room].host) {
            io.to(roomSessions[room].host).emit('viewer-joined', { viewerId: socket.id });
        }
        
        // Send existing session chat history to new viewer
        socket.emit('chat-history', roomSessions[room].chatHistory);
        
        const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
        io.to(room).emit('viewer-count-update', roomSize);
    });

    // Chat Relay & Session Preservation
    socket.on('send-chat-message', ({ room, sender, text }) => {
        const messageData = { sender, text, timestamp: new Date() };
        
        if (roomSessions[room]) {
            roomSessions[room].chatHistory.push(messageData);
        }
        
        io.to(room).emit('chat-message', messageData);
    });

    // WebRTC Signaling relay
    socket.on('offer', ({ target, offer }) => {
        io.to(target).emit('offer', { offer, callerId: socket.id });
    });

    socket.on('answer', ({ target, answer }) => {
        io.to(target).emit('answer', { answer, callerId: socket.id });
    });

    socket.on('ice-candidate', ({ target, candidate }) => {
        io.to(target).emit('ice-candidate', { candidate, callerId: socket.id });
    });

    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('viewer-left', { viewerId: socket.id });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
