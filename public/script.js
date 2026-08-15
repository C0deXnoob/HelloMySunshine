const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let screenStream = null;
// Maps each viewer socket ID to its own RTCPeerConnection instance
const peers = {};

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
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

// Real-time audience counter update
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
        document.getElementById('theaterVideo').controls = false; 
    }
}

// Host: Dedicated peer connection per joining viewer
socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;

    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }

    const pc = createPeerConnection(viewerId);
    peers[viewerId] = pc;

    if (screenStream) {
        addTracksToPeer(pc);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, offer });
});

// Targeted WebRTC Signaling Handlers
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

socket.on('viewer-left', ({ viewerId }) => {
    if (peers[viewerId]) {
        peers[viewerId].close();
        delete peers[viewerId];
    }
});

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(config);

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: targetId, candidate: e.candidate });
        }
    };

    // Viewer track receiver
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const videoElem = document.getElementById('theaterVideo');
        
        document.getElementById('waitingState').classList.add('hidden');
        if (videoElem.srcObject !== stream) {
            videoElem.srcObject = stream;
        }

        // Automatic playback trigger with fallback for mobile browser restrictions
        videoElem.play().catch(() => {
            videoElem.muted = true;
            videoElem.play();
        });
    };

    return pc;
}

function addTracksToPeer(pc) {
    if (!screenStream) return;
    screenStream.getTracks().forEach(track => {
        pc.addTrack(track, screenStream);
    });
}

// Host Screen Sharing Implementation
document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                displaySurface: "browser", 
                width: { max: 1920, ideal: 1920 }, 
                height: { max: 1080, ideal: 1080 }, 
                frameRate: { max: 30 } 
            },
            audio: { 
                systemAudio: "include", 
                autoGainControl: false, 
                echoCancellation: false, 
                noiseSuppression: false 
            }
        });

        const videoElem = document.getElementById('theaterVideo');
        videoElem.srcObject = screenStream;
        videoElem.muted = true; // Muted locally on host to avoid audio loopback
        document.getElementById('waitingState').classList.add('hidden');

        // Distribute screen stream across all connected viewers
        for (const viewerId of Object.keys(peers)) {
            const pc = peers[viewerId];
            addTracksToPeer(pc);
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { target: viewerId, offer });
        }

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

// Quality Switcher
const qualitySelect = document.getElementById('qualitySelect');
if (qualitySelect) {
    qualitySelect.onchange = (e) => {
        const selectedQuality = e.target.value;
        
        Object.keys(peers).forEach(callerId => {
            const pc = peers[callerId];
            const receivers = pc.getReceivers();
            
            receivers.forEach(receiver => {
                if (receiver.track && receiver.track.kind === 'video') {
                    if (selectedQuality === '1080') {
                        receiver.track.applyConstraints({ width: 1920, height: 1080 });
                    } else if (selectedQuality === '480') {
                        receiver.track.applyConstraints({ width: 854, height: 480 });
                    } else {
                        receiver.track.applyConstraints({});
                    }
                }
            });
        });
    };
}

// Fullscreen Toggle
document.getElementById('fullscreenBtn').onclick = () => {
    const container = document.getElementById('playerContainer');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) container.requestFullscreen();
        else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
};

// Picture-in-Picture Mode
document.getElementById('pipBtn').onclick = async () => {
    const videoElem = document.getElementById('theaterVideo');
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
            await videoElem.requestPictureInPicture();
        }
    } catch (err) {
        console.error("Picture-in-Picture error:", err);
    }
};

// Viewer Enable Audio Button
document.getElementById('unmuteBtn').onclick = () => {
    const videoElem = document.getElementById('theaterVideo');
    videoElem.muted = false;
    videoElem.play();
};
