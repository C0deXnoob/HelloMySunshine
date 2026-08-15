const socket = io("https://hellomysunshine.onrender.com");

let screenStream = null;
let currentRoom = null;
const peers = {};

// Public STUN servers to bypass NAT across different networks
const config = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ] 
};

document.getElementById('joinBtn').onclick = () => {
    currentRoom = document.getElementById('roomInput').value.trim();
    if (!currentRoom) return alert('Enter room ID');

    document.getElementById('room-selection').classList.add('hidden');
    document.getElementById('stream-container').classList.remove('hidden');

    socket.emit('join', currentRoom);
};

// Handle incoming connection from viewer devices
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
    };

    return pc;
}

// Fixed PC Desktop Broadcast Trigger (Prevents Duplicate Audio Loops)
document.getElementById('startBroadcastBtn').onclick = async () => {
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        return alert("Movie broadcasting must be initiated from your Desktop PC.");
    }

    try {
        // Capture screen video and system audio only
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "monitor" },
            audio: { 
                systemAudio: "include",
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // Mute local video element on host PC so sound doesn't echo locally out of your browser tab
        const localVideo = document.getElementById('remoteScreen');
        localVideo.srcObject = screenStream;
        localVideo.muted = true; 
        document.getElementById('waitingState').classList.add('hidden');

        // Send screen and clean system audio tracks to all viewing devices
        Object.keys(peers).forEach(callerId => {
            const pc = peers[callerId].pc;
            screenStream.getTracks().forEach(track => {
                const sender = pc.addTrack(track, screenStream);
                peers[callerId].senders.push(sender);
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
