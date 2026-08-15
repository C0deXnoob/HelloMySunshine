// Replace with your actual Render URL
const socket = io("https://hellomysunshine.onrender.com/"); 

let localStream, peerConnection, currentRoom;
let screenSender = null;

const config = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ] 
};

document.getElementById('joinBtn').onclick = async () => {
    currentRoom = document.getElementById('roomInput').value.trim();
    if (!currentRoom) return alert('Enter room ID');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('room-selection').classList.add('hidden');
        document.getElementById('call-container').classList.remove('hidden');

        socket.emit('join', currentRoom);
    } catch (err) {
        alert("Camera and Microphone access are required.");
    }
};

socket.on('user-connected', async () => {
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer, room: currentRoom });
});

socket.on('offer', async (data) => {
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer, room: currentRoom });
});

socket.on('answer', async (data) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', candidate => {
    if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

function createPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(config);

    // Send local camera & mic
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Receive tracks (camera + screen share)
    peerConnection.ontrack = (event) => {
        const stream = event.streams[0];
        // Distinguish screen share track from main camera stream
        if (event.track.kind === 'video' && event.streams[0].getVideoTracks().length > 1) {
            document.getElementById('screenVideo').srcObject = stream;
            document.getElementById('screenContainer').classList.remove('hidden');
        } else {
            document.getElementById('remoteVideo').srcObject = stream;
        }
    };

    peerConnection.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, room: currentRoom });
    };
}

// Screen Sharing (Desktop Browsers Only)
document.getElementById('shareScreenBtn').onclick = async () => {
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        return alert("Mobile browsers do not support screen sharing. Please share screen from a desktop PC.");
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { systemAudio: "include" }
        });

        const screenTrack = screenStream.getVideoTracks()[0];
        document.getElementById('screenVideo').srcObject = screenStream;
        document.getElementById('screenContainer').classList.remove('hidden');

        // Add screen track as a separate track without replacing camera
        if (peerConnection) {
            screenSender = peerConnection.addTrack(screenTrack, screenStream);
        }

        document.getElementById('shareScreenBtn').classList.add('hidden');
        document.getElementById('stopShareBtn').classList.remove('hidden');

        screenTrack.onended = stopScreenShare;
    } catch (err) {
        console.error("Screen share canceled or failed:", err);
    }
};

document.getElementById('stopShareBtn').onclick = stopScreenShare;

function stopScreenShare() {
    document.getElementById('screenContainer').classList.add('hidden');
    document.getElementById('shareScreenBtn').classList.remove('hidden');
    document.getElementById('stopShareBtn').classList.add('hidden');

    if (screenSender && peerConnection) {
        peerConnection.removeTrack(screenSender);
        screenSender = null;
    }
}