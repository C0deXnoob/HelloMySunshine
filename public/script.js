const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";
let screenStream = null;
const peers = {};

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

// 1. Room Logic
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');
    currentRoom = room;
    isHost = true;
    socket.emit('create-room', { room, identity: userIdentity });
    setupUI('Host');
};

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

// 2. Chat Logic & Mobile Drawer Controls
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const chatDrawer = document.getElementById('chatDrawer');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const closeChatBtn = document.getElementById('closeChatBtn');

if (toggleChatBtn) {
    toggleChatBtn.onclick = () => chatDrawer.classList.toggle('open');
}
if (closeChatBtn) {
    closeChatBtn.onclick = () => chatDrawer.classList.remove('open');
}

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

// 3. WebRTC Signaling Engine
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    
    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }
    
    const pc = createPeerConnection(viewerId);
    peers[viewerId] = pc;

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

    pc.ontrack = (event) => {
        const videoElem = document.getElementById('theaterVideo');
        const waitingState = document.getElementById('waitingState');
        const unmuteBtn = document.getElementById('unmuteBtn');

        if (event.streams && event.streams[0]) {
            videoElem.srcObject = event.streams[0];
        } else {
            videoElem.srcObject = new MediaStream([event.track]);
        }

        if (waitingState) waitingState.classList.add('hidden');

        // Unmute Handling for Mobile Browsers
        videoElem.muted = false;
        videoElem.play().catch(() => {
            // If browser blocks unmuted autoplay, mute and show the explicit tap-to-unmute banner
            videoElem.muted = true;
            videoElem.play();
            if (unmuteBtn) {
                unmuteBtn.classList.remove('hidden');
                unmuteBtn.onclick = () => {
                    videoElem.muted = false;
                    unmuteBtn.classList.add('hidden');
                };
            }
        });
    };

    return pc;
}

function addTracksToPeer(pc, stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
}

// 4. Host Screen Share Engine
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopScreenBtn = document.getElementById('stopScreenBtn');

if (shareScreenBtn) {
    shareScreenBtn.onclick = async () => {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser", width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true // Captures browser tab audio
            });

            const videoElem = document.getElementById('theaterVideo');
            videoElem.srcObject = screenStream;
            videoElem.muted = true;
            document.getElementById('waitingState')?.classList.add('hidden');

            for (const viewerId of Object.keys(peers)) {
                const pc = peers[viewerId];
                addTracksToPeer(pc, screenStream);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('offer', { target: viewerId, offer });
            }

            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');

            screenStream.getVideoTracks()[0].onended = stopBroadcast;
        } catch (err) {
            console.error("Screen sharing error:", err);
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
