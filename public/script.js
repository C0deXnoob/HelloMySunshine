const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";
let screenStream = null;
let peer = null;
let myPeerId = null;

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

// Setup PeerJS with Google STUN servers
function initPeerServer(customId) {
    peer = new Peer(customId, {
        config: {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                { urls: "stun:stun2.l.google.com:19302" },
                { urls: "stun:stun3.l.google.com:19302" }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        if (!isHost) {
            // Notify Host via Socket.io that viewer's Peer JS connection is ready
            socket.emit('viewer-peer-ready', { room: currentRoom, peerId: id });
        }
    });

    // Handle incoming screen stream on Viewer side
    peer.on('call', (call) => {
        call.answer(); 
        call.on('stream', (remoteStream) => {
            const videoElem = document.getElementById('theaterVideo');
            const waitingState = document.getElementById('waitingState');
            
            videoElem.srcObject = remoteStream;
            if (waitingState) waitingState.classList.add('hidden');

            videoElem.play().catch(() => {
                videoElem.muted = true;
                videoElem.play();
                showTapToUnmuteOverlay(videoElem);
            });
        });
    });
}

function showTapToUnmuteOverlay(videoElem) {
    let overlay = document.getElementById('unmuteOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'unmuteOverlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;color:#fff;font-weight:bold;z-index:100;cursor:pointer;padding:1rem;text-align:center;border-radius:12px;';
        overlay.innerHTML = '🔊 Tap Screen to Unmute';
        document.querySelector('.player-container').appendChild(overlay);
    }
    
    overlay.onclick = () => {
        videoElem.muted = false;
        videoElem.play();
        overlay.remove();
    };
}

// Room Controls
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');
    currentRoom = room;
    isHost = true;
    
    initPeerServer(`${room}-host-${Date.now()}`);
    socket.emit('create-room', { room, identity: userIdentity });
    setupUI('Host');
};

document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');
    currentRoom = room;
    isHost = false;
    
    initPeerServer(`${room}-viewer-${Date.now()}`);
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

// Host Screen Share Engine
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopScreenBtn = document.getElementById('stopScreenBtn');

if (shareScreenBtn) {
    shareScreenBtn.onclick = async () => {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser", width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true
            });

            const videoElem = document.getElementById('theaterVideo');
            videoElem.srcObject = screenStream;
            videoElem.muted = true;
            document.getElementById('waitingState')?.classList.add('hidden');

            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');

            // Signal viewers that screen stream is live
            socket.emit('host-sharing-started', { room: currentRoom });

            screenStream.getVideoTracks()[0].onended = stopBroadcast;
        } catch (err) {
            console.error("Screen Share Error:", err);
        }
    };
}

// Trigger call to viewer when viewer signals they are ready
socket.on('connect-viewer', ({ peerId }) => {
    if (isHost && screenStream && peerId) {
        peer.call(peerId, screenStream);
    }
});

// If Host starts sharing after viewer is already in the room
socket.on('host-is-sharing', () => {
    if (!isHost && myPeerId) {
        socket.emit('viewer-peer-ready', { room: currentRoom, peerId: myPeerId });
    }
});

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

// Fullscreen Handler for Video
const fullscreenBtn = document.getElementById('fullscreenBtn');
if (fullscreenBtn) {
    fullscreenBtn.onclick = toggleFullscreen;
}

function toggleFullscreen() {
    const videoContainer = document.querySelector('.player-container');
    if (!document.fullscreenElement) {
        if (videoContainer.requestFullscreen) {
            videoContainer.requestFullscreen();
        } else if (videoContainer.webkitRequestFullscreen) { /* Safari */
            videoContainer.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

// Live Chat Engine
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
