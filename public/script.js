const socket = io("https://hellomysunshine.onrender.com");

let currentRoom = null;
let isHost = false;
let screenStream = null;
let localStream = null; // User's webcam and microphone stream
const peers = {};

// ICE Configuration with Metered TURN Relay for Cross-City Connectivity
const config = {
    iceServers: [
        {
            urls: "stun:stun.relay.metered.ca:80",
        },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "4197c2939986cbb90cde1ca8",
            credential: "auhTPCKBx8KLH3Bj",
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "4197c2939986cbb90cde1ca8",
            credential: "auhTPCKBx8KLH3Bj",
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "4197c2939986cbb90cde1ca8",
            credential: "auhTPCKBx8KLH3Bj",
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "4197c2939986cbb90cde1ca8",
            credential: "auhTPCKBx8KLH3Bj",
        },
    ],
    iceTransportPolicy: 'all'
};

// 1. Host Action: Start Room
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');

    currentRoom = room;
    isHost = true;
    socket.emit('create-room', room);
    setupUI('Host');
};

// 2. Viewer Action: Join Room
document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');

    currentRoom = room;
    isHost = false;
    socket.emit('join-room', room);
    setupUI('Viewer');
};

socket.on('error-msg', (msg) => alert(msg));

// Update viewer counter
socket.on('viewer-count-update', (count) => {
    document.getElementById('viewerCount').innerText = count;
});

// Auto-reconnect handshake for viewers on dropped connection
socket.on('connect', () => {
    if (!isHost && currentRoom) {
        socket.emit('join-room', currentRoom);
    }
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

// Host handling: Create isolated peer connection for every joining viewer
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
    if (localStream) {
        addTracksToPeer(pc, localStream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, offer });
});

// Targeted Signaling Handlers
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

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const track = event.track;

        // Route screen tracks to main theater display, video call tracks to user preview
        if (track.kind === 'video' && stream.getVideoTracks().length > 0) {
            const videoElem = document.getElementById('theaterVideo');
            const remoteCamElem = document.getElementById('remoteCamVideo');

            if (remoteCamElem && stream !== screenStream) {
                remoteCamElem.srcObject = stream;
                remoteCamElem.play().catch(() => {});
            } else {
                document.getElementById('waitingState').classList.add('hidden');
                if (videoElem.srcObject !== stream) {
                    videoElem.srcObject = stream;
                }
                videoElem.play().catch(() => {
                    videoElem.muted = true;
                    videoElem.play();
                });
            }
        }
    };

    return pc;
}

function addTracksToPeer(pc, stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
    });
}

// Video Call / Webcam Toggle Logic
const toggleCamBtn = document.getElementById('toggleCamBtn');
if (toggleCamBtn) {
    toggleCamBtn.onclick = async () => {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: true
                });

                const localCamElem = document.getElementById('localCamVideo');
                if (localCamElem) {
                    localCamElem.srcObject = localStream;
                    localCamElem.muted = true;
                }

                for (const callerId of Object.keys(peers)) {
                    const pc = peers[callerId];
                    addTracksToPeer(pc, localStream);

                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit('offer', { target: callerId, offer });
                }

                toggleCamBtn.innerText = "Stop Video Call";
                toggleCamBtn.classList.add('btn-danger');
            } catch (err) {
                console.error("Camera access error:", err);
                alert("Unable to access camera and microphone.");
            }
        } else {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;

            const localCamElem = document.getElementById('localCamVideo');
            if (localCamElem) localCamElem.srcObject = null;

            toggleCamBtn.innerText = "Start Video Call";
            toggleCamBtn.classList.remove('btn-danger');
        }
    };
}

// Screen Sharing Logic
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

// Picture-in-Picture Trigger Button
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

// Auto Picture-in-Picture when tab/app is minimized
document.addEventListener('visibilitychange', async () => {
    const videoElem = document.getElementById('theaterVideo');
    
    if (document.visibilityState === 'hidden') {
        if (videoElem && videoElem.srcObject && !document.pictureInPictureElement && document.pictureInPictureEnabled) {
            try {
                await videoElem.requestPictureInPicture();
            } catch (err) {
                console.error("Auto-PiP error:", err);
            }
        }
    }
});

// MediaSession setup to prevent OS background stream suspension
if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
        title: "Live Movie Theater",
        artist: "Shared Watch Session",
    });

    navigator.mediaSession.setActionHandler('play', () => {});
    navigator.mediaSession.setActionHandler('pause', () => {});
}

// Viewer Enable Audio Button
document.getElementById('unmuteBtn').onclick = () => {
    const videoElem = document.getElementById('theaterVideo');
    videoElem.muted = false;
    videoElem.play();
};
