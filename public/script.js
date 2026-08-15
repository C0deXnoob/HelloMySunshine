const socket = io("https://hellomysunshine.onrender.com");

let screenStream = null;
let currentRoom = null;
const peers = {};

// Use Google STUN with WebRTC low-latency parameters
const config = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle', // Packs audio and video into a single network stream to eliminate sync offset
    rtcpMuxPolicy: 'require'
};

document.getElementById('joinBtn').onclick = () => {
    currentRoom = document.getElementById('roomInput').value.trim();
    if (!currentRoom) return alert('Enter room ID');

    document.getElementById('room-selection').classList.add('hidden');
    document.getElementById('stream-container').classList.remove('hidden');

    socket.emit('join', currentRoom);
};

socket.on('user-joined', async ({ callerId }) => {
    const pc = createPeerConnection(callerId);

    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: callerId, offer });
});

socket.on('offer', async ({ offer, callerId }) => {
    const pc = createPeerConnection(callerId);

    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

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

socket.on('user-left', ({ callerId }) => {
    if (peers[callerId]) {
        peers[callerId].pc.close();
        delete peers[callerId];
    }
});

function createPeerConnection(callerId) {
    const pc = new RTCPeerConnection(config);
    peers[callerId] = { pc, senders: [] };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: callerId, candidate: e.candidate });
        }
    };

    // Receiving remote screen stream on viewer devices
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const remoteVideo = document.getElementById('remoteScreen');
        document.getElementById('waitingState').classList.add('hidden');
        remoteVideo.srcObject = stream;

        // Force zero-latency playback mode on receivers
        remoteVideo.play();
        if ('fastSeek' in remoteVideo) {
            remoteVideo.fastSeek(remoteVideo.duration);
        }
    };

    return pc;
}

// Low-Latency Broadcast Setup
document.getElementById('startBroadcastBtn').onclick = async () => {
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        return alert("Movie broadcasting must be initiated from your Desktop PC.");
    }

    try {
        // Enforce strict low-latency video & audio constraints
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                displaySurface: "browser", // Tab capture provides lowest latency
                width: { max: 1280, ideal: 1280 },
                height: { max: 720, ideal: 720 },
                frameRate: { max: 30, ideal: 30 }
            },
            audio: { 
                systemAudio: "include",
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                latency: 0
            }
        });

        const localVideo = document.getElementById('remoteScreen');
        localVideo.srcObject = screenStream;
        localVideo.muted = true; 
        document.getElementById('waitingState').classList.add('hidden');

        // Apply bitrate limits to senders to prevent network buffer overflow
        Object.keys(peers).forEach(callerId => {
            const pc = peers[callerId].pc;
            screenStream.getTracks().forEach(track => {
                const sender = pc.addTrack(track, screenStream);
                peers[callerId].senders.push(sender);

                // Lower video encoding bitrate cap for smooth real-time delivery
                if (track.kind === 'video') {
                    const params = sender.getParameters();
                    if (!params.encodings) params.encodings = [{}];
                    params.encodings[0].maxBitrate = 2500000; // Cap at 2.5 Mbps
                    sender.setParameters(params);
                }
            });
        });

        document.getElementById('startBroadcastBtn').classList.add('hidden');
        document.getElementById('stopBroadcastBtn').classList.remove('hidden');

        screenStream.getVideoTracks()[0].onended = stopBroadcast;

    } catch (err) {
        console.error("Screen share start error:", err);
    }
};

document.getElementById('stopBroadcastBtn').onclick = stopBroadcast;

function stopBroadcast() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    const localVideo = document.getElementById('remoteScreen');
    localVideo.srcObject = null;
    localVideo.muted = false;

    document.getElementById('waitingState').classList.remove('hidden');
    document.getElementById('startBroadcastBtn').classList.remove('hidden');
    document.getElementById('stopBroadcastBtn').classList.add('hidden');

    Object.keys(peers).forEach(callerId => {
        const { pc, senders } = peers[callerId];
        senders.forEach(sender => pc.removeTrack(sender));
        peers[callerId].senders = [];
    });
}
