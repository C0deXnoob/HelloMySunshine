const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";
let screenStream = null;
let localStream = null;
const peers = {};

// Updated to OpenRelay (Free TURN Servers)
const config = {
    iceServers: [
        { urls: "stun:openrelay.metered.ca:80" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelay",
            credential: "openrelay"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelay",
            credential: "openrelay"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelay",
            credential: "openrelay"
        }
    ],
    iceTransportPolicy: 'all'
};

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('localCamLabel').innerText = name;
    document.getElementById('remoteCamLabel').innerText = name === "Your Bubu" ? "Your Dudu" : "Your Bubu";
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

// Live Chat Handling
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentRoom) return;

    const msgData = { room: currentRoom, sender: userIdentity, text };
    socket.emit('send-chat-message', msgData);
    chatInput.value = '';
};

socket.on('chat-message', (data) => {
    renderChatMessage(data);
});

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

// WebRTC Signaling
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }
    const pc = createPeerConnection(viewerId);
    peers[viewerId] = pc;

    if (screenStream) addTracksToPeer(pc, screenStream);
    if (localStream) addTracksToPeer(pc, localStream);

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
        const remoteStream = event.streams[0];
        const videoElem = document.getElementById('theaterVideo');
        const remoteCamElem = document.getElementById('remoteCamVideo');

        // Check if track is screen share or webcam stream
        if (event.track.kind === 'video') {
            if (remoteStream === screenStream || event.track.label.includes('screen') || event.track.label.includes('display')) {
                document.getElementById('waitingState').classList.add('hidden');
                videoElem.srcObject = remoteStream;
                videoElem.play().catch(() => {
                    videoElem.muted = true;
                    videoElem.play();
                });
            } else {
                if (remoteCamElem) {
                    remoteCamElem.srcObject = remoteStream;
                    remoteCamElem.play().catch(err => console.error("Remote cam play error:", err));
                }
            }
        } else if (event.track.kind === 'audio') {
            if (remoteCamElem && remoteStream !== screenStream) {
                remoteCamElem.srcObject = remoteStream;
            }
        }
    };

    return pc;
}

function addTracksToPeer(pc, stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
}

// Camera Toggle
document.getElementById('toggleCamBtn').onclick = async () => {
    const toggleCamBtn = document.getElementById('toggleCamBtn');
    
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 }, 
                audio: true 
            });
            
            document.getElementById('localCamVideo').srcObject = localStream;

            for (const targetId of Object.keys(peers)) {
                const pc = peers[targetId];
                
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('offer', { target: targetId, offer });
            }

            toggleCamBtn.innerText = "Stop Video Call";
            toggleCamBtn.classList.add('btn-danger');
        } catch (err) {
            console.error("Camera access error:", err);
            alert("Unable to access camera or microphone.");
        }
    } else {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        document.getElementById('localCamVideo').srcObject = null;
        
        toggleCamBtn.innerText = "Start Video Call";
        toggleCamBtn.classList.remove('btn-danger');
    }
};

// Screen Sharing Logic
document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser", width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: { systemAudio: "include" }
        });

        const videoElem = document.getElementById('theaterVideo');
        videoElem.srcObject = screenStream;
        videoElem.muted = true;
        document.getElementById('waitingState').classList.add('hidden');

        for (const viewerId of Object.keys(peers)) {
            const pc = peers[viewerId];
            addTracksToPeer(pc, screenStream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: viewerId, offer });
        }

        document.getElementById('shareScreenBtn').classList.add('hidden');
        document.getElementById('stopScreenBtn').classList.remove('hidden');
        screenStream.getVideoTracks()[0].onended = stopBroadcast;
    } catch (err) {
        console.error(err);
    }
};

document.getElementById('stopScreenBtn').onclick = stopBroadcast;

function stopBroadcast() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    document.getElementById('theaterVideo').srcObject = null;
    document.getElementById('waitingState').classList.remove('hidden');
    document.getElementById('shareScreenBtn').classList.remove('hidden');
    document.getElementById('stopScreenBtn').classList.add('hidden');
}
