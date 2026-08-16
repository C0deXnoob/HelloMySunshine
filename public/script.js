const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";
let screenStream = null;
let peer = null;
const activeCalls = {};

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

// Setup PeerJS for Free Peer-to-Peer Traversal
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

    // Handle incoming screen stream call on Viewer side
    peer.on('call', (call) => {
        call.answer(); // Answer incoming host broadcast
        call.on('stream', (remoteStream) => {
            const videoElem = document.getElementById('theaterVideo');
            const waitingState = document.getElementById('waitingState');
            
            videoElem.srcObject = remoteStream;
            videoElem.muted = false; // Always play audio
            if (waitingState) waitingState.classList.add('hidden');

            videoElem.play().catch(() => {
                // Mobile Browser Autoplay safety fallback
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
        overlay.innerHTML = '🔊 Tap Screen to Enable Audio & Video';
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
    
    // Host peer ID is room-host
    initPeerServer(`${room}-host`);
    socket.emit('create-room', { room, identity: userIdentity });
    setupUI('Host');
};

document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');
    currentRoom = room;
    isHost = false;
    
    // Viewer peer ID is dynamic based on socket
    initPeerServer(`${room}-viewer-${Math.floor(Math.random() * 1000)}`);
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
            videoElem.muted = true; // Local host display is muted to prevent echo
            document.getElementById('waitingState')?.classList.add('hidden');

            // Notify server that host started sharing
            socket.emit('host-started-sharing', { room: currentRoom });

            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');

            screenStream.getVideoTracks()[0].onended = stopBroadcast;
        } catch (err) {
            console.error("Screen Share Error:", err);
        }
    };
}

// When a viewer joins or requests stream, host calls the viewer
socket.on('viewer-joined', ({ viewerPeerId }) => {
    if (isHost && screenStream && viewerPeerId) {
        const call = peer.call(viewerPeerId, screenStream);
        activeCalls[viewerPeerId] = call;
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
