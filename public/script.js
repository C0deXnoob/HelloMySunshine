const socket = io("https://hellomysunshine.onrender.com/");
let localStream, screenStream, peerConnection, currentRoom;
const config = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ] 
};

document.getElementById('joinBtn').onclick = async () => {
    currentRoom = document.getElementById('roomInput').value.trim();
    if (!currentRoom) return alert('Enter room ID');

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('room-selection').classList.add('hidden');
    document.getElementById('call-container').classList.remove('hidden');

    socket.emit('join', currentRoom);
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
    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = e => document.getElementById('remoteVideo').srcObject = e.streams[0];
    peerConnection.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, room: currentRoom });
    };
}

document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        // Try requesting screen share with audio hint
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        const videoTrack = screenStream.getVideoTracks()[0];
        const audioTrack = screenStream.getAudioTracks()[0];

        if (peerConnection) {
            // Replace video track for the remote user
            const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(videoTrack);
            }

            // Replace or send screen audio track if available
            if (audioTrack) {
                const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (audioSender) {
                    await audioSender.replaceTrack(audioTrack);
                }
            }
        }

        // Show screen locally
        document.getElementById('localVideo').srcObject = screenStream;
        document.getElementById('shareScreenBtn').classList.add('hidden');
        document.getElementById('stopShareBtn').classList.remove('hidden');

        // Restore camera stream when user clicks browser's native "Stop Sharing" bar
        videoTrack.onended = stopScreenSharing;

    } catch (err) {
        console.error("Screen sharing error:", err);
        alert("Screen share could not start. Ensure you are sharing from a desktop browser.");
    }
};
