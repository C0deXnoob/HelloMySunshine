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

document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');

    currentRoom = room;
    isHost = true;
    socket.emit('create-room', room);
    setupUI('Host');
};

document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');

    currentRoom = room;
    isHost = false;
    socket.emit('join-room', room);
    setupUI('Viewer');
};

socket.on('error-msg', (msg) => alert(msg));
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

socket.on('viewer-joined', async ({ viewerId }) => {
    if (!isHost) return;
    
    if (peers[viewerId]) {
        peers[viewerId].pc.close();
        delete peers[viewerId];
    }

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

    let pc = peers[callerId]?.pc;
    if (!pc) pc = createPeerConnection(callerId);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: callerId, answer });
});

socket.on('answer', async ({ answer, callerId }) => {
    if (peers[callerId] && peers[callerId].pc) {
        await peers[callerId].pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ candidate, callerId }) => {
    if (peers[callerId] && peers[callerId].pc) {
        try {
            await peers[callerId].pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("ICE candidate error:", err);
        }
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

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const videoElem = document.getElementById('theaterVideo');
        
        document.getElementById('waitingState').classList.add('hidden');
        if (videoElem.srcObject !== stream) {
            videoElem.srcObject = stream;
        }

        videoElem.play().catch(() => {
            videoElem.muted = true;
            videoElem.play();
        });
    };

    return pc;
}

// Configures multi-bitrate streams (1080p high layer and 480p low layer)
function addSimulcastTracks(pc) {
    if (!screenStream) return;
    screenStream.getTracks().forEach(track => {
        if (track.kind === 'video') {
            pc.addTransceiver(track, {
                direction: 'sendonly',
                streams: [screenStream],
                sendEncodings: [
                    { rid: 'high', maxBitrate: 4500000 }, // 1080p
                    { rid: 'low', maxBitrate: 800000, scaleResolutionDownBy: 2.25 } // 480p
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
            video: { 
                displaySurface: "browser", 
                width: { max: 1920, ideal: 1920 }, 
                height: { max: 1080, ideal: 1080 }, 
                frameRate: { max: 30 } 
            },
            audio: { systemAudio: "include", autoGainControl: false, echoCancellation: false, noiseSuppression: false }
        });

        const videoElem = document.getElementById('theaterVideo');
        videoElem.srcObject = screenStream;
        videoElem.muted = true;
        document.getElementById('waitingState').classList.add('hidden');

        Object.keys(peers).forEach(viewerId => {
            addSimulcastTracks(peers[viewerId].pc);
            peers[viewerId].pc.createOffer().then(offer => {
                peers[viewerId].pc.setLocalDescription(offer);
                socket.emit('offer', { target: viewerId, offer });
            });
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

// Viewer Quality Switcher Implementation
document.getElementById('qualitySelect').onchange = (e) => {
    const selectedQuality = e.target.value;
    
    Object.keys(peers).forEach(callerId => {
        const pc = peers[callerId].pc;
        const receivers = pc.getReceivers();
        
        receivers.forEach(receiver => {
            if (receiver.track && receiver.track.kind === 'video') {
                const params = receiver.getParameters();
                if (!params.degradationPreference) {
                    params.degradationPreference = 'maintain-framerate';
                }

                // Adjust receiver limits based on selected resolution
                if (selectedQuality === '1080') {
                    receiver.track.applyConstraints({ width: 1920, height: 1080 });
                } else if (selectedQuality === '480') {
                    receiver.track.applyConstraints({ width: 854, height: 480 });
                } else {
                    // Reset constraints for Auto mode
                    receiver.track.applyConstraints({});
                }
            }
        });
    });
};

// Fullscreen
document.getElementById('fullscreenBtn').onclick = () => {
    const container = document.getElementById('playerContainer');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) container.requestFullscreen();
        else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
};

// Picture-in-Picture (Minimize)
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

// Unmute Audio Button
document.getElementById('unmuteBtn').onclick = () => {
    const videoElem = document.getElementById('theaterVideo');
    videoElem.muted = false;
    videoElem.play();
};
