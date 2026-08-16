const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";
let screenStream = null;
const peers = {}; // Holds peer connections for every connected device

// Optimized STUN / TURN Configuration
const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:openrelay.metered.ca:80" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceTransportPolicy: 'all'
};

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

// 1. Host Action
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');
    currentRoom = room;
    isHost = true;
    socket.emit('create-room', { room, identity: userIdentity });
    setupUI('Host');
};

// 2. Viewer Action
document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');
    currentRoom = room;
    isHost = false;
    socket.emit('join-room', { room, identity: userIdentity });
    setupUI('Viewer');
};

socket.on('error-msg', (msg) => alert(msg));
socket.on('viewer-count-update', (count) => {
    document.getElementById('viewerCount').innerText = count;
});

function setupUI(role) {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('theater-page').classList.remove('hidden');
    document.getElementById('roleBadge').innerText = `${role} (${userIdentity})`;

    if (role === 'Host') {
        document.getElementById('hostControls').classList.remove('hidden');
    } else {
        document.getElementById('viewerControls').classList.remove('hidden');
    }
}

// 3. Live Chat Logic
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

if (chatForm) {
    chatForm.onsubmit = (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text || !currentRoom) return;

        const msgData = { room: currentRoom, sender: userIdentity, text };
        socket.emit('send-chat-message', msgData);
        chatInput.value = '';
    };
}

socket.on('chat-message', (data) => renderChatMessage(data));
socket.on('chat-history', (history) => {
    chatMessages.innerHTML = '';
    history.forEach(msg => renderChatMessage(msg));
});

function renderChatMessage({ sender, text }) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="sender">${sender}:</span><span>${text}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 4. Multi-Device WebRTC Signaling Strategy
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    
    // Clean up existing stale peer connection if present
    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }
    
    const pc = createPeerConnection(viewerId);
    peers[viewerId] = pc;

    // If host is already screen sharing, immediately bind tracks to new device connection
    if (screenStream) {
        addTracksToPeer(pc, screenStream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, offer });
});

socket.on('offer', async ({ offer, callerId }) => {
    if (isHost) return;
    let pc = peers[callerId];
    if (!pc) {
        pc = createPeerConnection(callerId);
        peers[callerId] = pc;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: callerId, answer });
});

socket.on('answer', async ({ answer, callerId }) => {
    if (peers[callerId]) {
        await peers[callerId].setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ candidate, callerId }) => {
    if (peers[callerId]) {
        try {
            await peers[callerId].addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("ICE candidate error:", err);
        }
    }
});

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(config);

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: targetId, candidate: e.candidate });
        }
    };

    // Route incoming remote screen stream directly into theater video element
    pc.ontrack = (event) => {
        const videoElem = document.getElementById('theaterVideo');
        const waitingState = document.getElementById('waitingState');

        if (event.streams && event.streams[0]) {
            videoElem.srcObject = event.streams[0];
        } else {
            videoElem.srcObject = new MediaStream([event.track]);
        }

        if (waitingState) waitingState.classList.add('hidden');

        videoElem.play().catch(() => {
            // Autoplay safety policy fallback: start muted
            videoElem.muted = true;
            videoElem.play();
        });
    };

    return pc;
}

function addTracksToPeer(pc, stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
}

// 5. Screen Sharing Execution
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopScreenBtn = document.getElementById('stopScreenBtn');

if (shareScreenBtn) {
    shareScreenBtn.onclick = async () => {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser", width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: { systemAudio: "include" }
            });

            // Local Host Preview
            const videoElem = document.getElementById('theaterVideo');
            videoElem.srcObject = screenStream;
            videoElem.muted = true;
            document.getElementById('waitingState')?.classList.add('hidden');

            // Broadcast tracks to ALL connected viewer devices simultaneously
            for (const viewerId of Object.keys(peers)) {
                const pc = peers[viewerId];
                addTracksToPeer(pc, screenStream);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('offer', { target: viewerId, offer });
            }

            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');

            // Handle user clicking browser's built-in "Stop sharing" bar
            screenStream.getVideoTracks()[0].onended = stopBroadcast;
        } catch (err) {
            console.error("Screen sharing failed:", err);
        }
    };
}

if (stopScreenBtn) {
    stopScreenBtn.onclick = stopBroadcast;
}

function stopBroadcast() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    const videoElem = document.getElementById('theaterVideo');
    if (videoElem) videoElem.srcObject = null;
    
    document.getElementById('waitingState')?.classList.remove('hidden');
    if (shareScreenBtn) shareScreenBtn.classList.remove('hidden');
    if (stopScreenBtn) stopScreenBtn.classList.add('hidden');
}
