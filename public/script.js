const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let screenStream = null;
const peers = {};

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};

// 1. Host Path: Start Movie
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');

    currentRoom = room;
    isHost = true;
    socket.emit('create-room', room);

    setupUI('Host');
};

// 2. Viewer Path: Join Room
document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');

    currentRoom = room;
    isHost = false;
    socket.emit('join-room', room);

    setupUI('Viewer');
};

socket.on('error-msg', (msg) => alert(msg));

// Update Live Viewer Counter
socket.on('viewer-count-update', (count) => {
    document.getElementById('viewerCount').innerText = count;
});

function setupUI(role) {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('theater-page').classList.remove('hidden');
    document.getElementById('roleBadge').innerText = role;

    if (role === 'Host') {
        document.getElementById('hostControls').classList.remove('hidden');
    } else {
        document.getElementById('viewerControls').classList.remove('hidden');
        // Disable controls on viewer video player
        document.getElementById('theaterVideo').controls = false; 
    }
}

// Host WebRTC Signalling for incoming viewers
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    const pc = createPeerConnection(viewerId);

    if (screenStream) {
        addSimulcastTracks(pc);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, offer });
});

socket.on('offer', async ({ offer, callerId }) => {
    if (isHost) return;
    const pc = createPeerConnection(callerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: callerId, answer });
});

socket.on('answer', async ({ answer, callerId }) => {
    if (peers[callerId]) {
        await peers[callerId].pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ candidate, callerId }) => {
    if (peers[callerId]) {
        await peers[callerId].pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('viewer-left', ({ viewerId }) => {
    if (peers[viewerId]) {
        peers[viewerId].pc.close();
        delete peers[viewerId];
    }
});

function createPeerConnection(callerId) {
    const pc = new RTCPeerConnection(config);
    peers[callerId] = { pc, senders: [] };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { target: callerId, candidate: e.candidate });
    };

    // Receiver Track Management (Zero-Latency + Perfect Sync)
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const videoElem = document.getElementById('theaterVideo');
        document.getElementById('waitingState').classList.add('hidden');
        videoElem.srcObject = stream;
        videoElem.play();
    };

    return pc;
}

// Add tracks with dynamic quality (Simulcast / Adaptive Bitrates)
function addSimulcastTracks(pc) {
    screenStream.getTracks().forEach(track => {
        if (track.kind === 'video') {
            // Adaptive layers based on viewer connection speeds
            pc.addTransceiver(track, {
                direction: 'sendonly',
                streams: [screenStream],
                sendEncodings: [
                    { rid: 'high', maxBitrate: 2500000 },
                    { rid: 'low', maxBitrate: 500000, scaleResolutionDownBy: 2.0 }
                ]
            });
        } else {
            pc.addTrack(track, screenStream);
        }
    });
}

// Host Screen Sharing Controls
document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser", width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } },
            audio: { systemAudio: "include", autoGainControl: false, echoCancellation: false, noiseSuppression: false }
        });

        const videoElem = document.getElementById('theaterVideo');
        videoElem.srcObject = screenStream;
        videoElem.muted = true; // Prevents host speaker loopback
        document.getElementById('waitingState').classList.add('hidden');

        // Connect stream to all active viewers
        Object.keys(peers).forEach(viewerId => {
            addSimulcastTracks(peers[viewerId].pc);
        });

        document.getElementById('shareScreenBtn').classList.add('hidden');
        document.getElementById('stopScreenBtn').classList.remove('hidden');

        screenStream.getVideoTracks()[0].onended = stopBroadcast;
    } catch (err) {
        console.error("Screen share error:", err);
    }
};

document.getElementById('stopScreenBtn').onclick = stopBroadcast;

function stopBroadcast() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    const videoElem = document.getElementById('theaterVideo');
    videoElem.srcObject = null;
    document.getElementById('waitingState').classList.remove('hidden');

    document.getElementById('shareScreenBtn').classList.remove('hidden');
    document.getElementById('stopScreenBtn').classList.add('hidden');
}

// Unmute audio for mobile viewers blocked by browser policy
document.getElementById('unmuteBtn').onclick = () => {
    const videoElem = document.getElementById('theaterVideo');
    videoElem.muted = false;
    videoElem.play();
};
