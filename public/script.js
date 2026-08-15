const socket = io("https://hellomysunshine.onrender.com");

let screenStream = null;
let currentRoom = null;
const peers = {};

// Public Google STUN servers to bypass NAT across different cellular/Wi-Fi networks
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

// When another device connects to the room
socket.on('user-joined', async ({ callerId }) => {
    const pc = createPeerConnection(callerId);

    // If PC is already broadcasting screen + audio, push tracks to new connected device
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

    // Receiving remote screen stream on secondary devices
    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const remoteVideo = document.getElementById('remoteScreen');
        document.getElementById('waitingState').classList.add('hidden');
        remoteVideo.srcObject = stream;
    };

    return pc;
}

// PC Desktop Broadcast Trigger
document.getElementById('startBroadcastBtn').onclick = async () => {
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        return alert("Movie broadcasting must be initiated from your Desktop PC.");
    }

    try {
        // Request desktop screen and system audio
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "monitor" },
            audio: { systemAudio: "include" }
        });

        document.getElementById('remoteScreen').srcObject = screenStream;
        document.getElementById('waitingState').classList.add('hidden');

        // Distribute screen stream tracks to all connected viewing devices
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

    document.getElementById('remoteScreen').srcObject = null;
    document.getElementById('waitingState').classList.remove('hidden');
    document.getElementById('startBroadcastBtn').classList.remove('hidden');
    document.getElementById('stopBroadcastBtn').classList.add('hidden');

    Object.keys(peers).forEach(callerId => {
        const { pc, senders } = peers[callerId];
        senders.forEach(sender => pc.removeTrack(sender));
        peers[callerId].senders = [];
    });
}
