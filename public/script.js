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
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
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
    iceCandidatePoolSize: 10
};

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

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

    const videoElem = document.getElementById('theaterVideo');

    if (role === 'Host') {
        document.getElementById('hostControls').classList.remove('hidden');
        videoElem.controls = false;
    } else {
        document.getElementById('viewerControls').classList.remove('hidden');
        videoElem.controls = false;
    }
}

// Chat Engine
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

// WebRTC Signaling Protocol
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    
    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }
    
    const pc = createPeerConnection(viewerId);
    peers[viewerId] = pc;

    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
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
            console.error("ICE Candidate Error:", err);
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

        if (event.streams && event.streams[0]) {
            videoElem.srcObject = event.streams[0];
        } else {
            videoElem.srcObject = new MediaStream([event.track]);
        }

        if (waitingState) waitingState.classList.add('hidden');

        videoElem.muted = false;
        const playPromise = videoElem.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // Autoplay blocked by mobile browser - play muted first, un-mute on tap
                videoElem.muted = true;
                videoElem.play();
                showTapToUnmuteOverlay(videoElem);
            });
        }
    };

    return pc;
}

function showTapToUnmuteOverlay(videoElem) {
    let overlay = document.getElementById('unmuteOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'unmuteOverlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;color:#fff;font-weight:bold;z-index:100;cursor:pointer;padding:1rem;text-align:center;';
        overlay.innerHTML = '🔊 Tap Screen to Enable Video & Audio';
        document.querySelector('.player-container').appendChild(overlay);
    }
    
    overlay.onclick = () => {
        videoElem.muted = false;
        videoElem.play();
        overlay.remove();
    };
}

// Host Screen Share Controls
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

            for (const viewerId of Object.keys(peers)) {
                const pc = peers[viewerId];
                
                // Clear old senders
                const senders = pc.getSenders();
                senders.forEach(sender => pc.removeSender(sender));

                // Add new stream tracks
                screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('offer', { target: viewerId, offer });
            }

            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');

            screenStream.getVideoTracks()[0].onended = stopBroadcast;
        } catch (err) {
            console.error("Screen Share Error:", err);
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
