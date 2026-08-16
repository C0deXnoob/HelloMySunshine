let socket = null;
let currentRoom = null;
let userIdentity = "Your Bubu";
let isHostUser = false;

let peerConnection = null;
let localStream = null;
let iceCandidateQueue = [];

// Public Google STUN servers for cross-network connectivity
// Updated WebRTC configuration with STUN + TURN for Mobile Data / Carrier NAT
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelay',
            credential: 'openrelay'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelay',
            credential: 'openrelay'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelay',
            credential: 'openrelay'
        }
    ]
};

document.addEventListener("DOMContentLoaded", () => {
    
    try {
        socket = io("https://hellomysunshine.onrender.com");
        
        socket.on('viewer-count-update', (count) => {
            const countElem = document.getElementById('viewerCount');
            if (countElem) countElem.innerText = count;
        });

        socket.on('chat-message', (data) => renderChatMessage(data));
        socket.on('chat-history', (history) => {
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) {
                chatMessages.innerHTML = '';
                history.forEach(msg => renderChatMessage(msg));
            }
        });

        socket.on('session-ended', () => {
            alert('The session has ended.');
            resetSession();
        });

        socket.on('user-joined', async () => {
    if (isHostUser && localStream) {
        // Close old stale peer connection if re-connecting
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        await initiateOffer();
    }
});

        socket.on('signal', async (data) => {
            handleSignal(data.signal);
        });

    } catch (e) {
        console.error("Socket Connection Error:", e);
    }

    document.getElementById('btnBubu').onclick = () => selectIdentity('Your Bubu');
    document.getElementById('btnDudu').onclick = () => selectIdentity('Your Dudu');

    // Host Action
    document.getElementById('startMovieBtn').onclick = async () => {
        const room = document.getElementById('hostRoomInput').value.trim();
        if (!room) return alert('Enter a room code');
        currentRoom = room;
        isHostUser = true;

        try {
            // Request display media with constraints enforcing echo cancellation
            localStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 60 } },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            const videoElem = document.getElementById('remoteVideo');
            videoElem.srcObject = localStream;
            
            // Host video must be muted locally so host doesn't hear double audio
            videoElem.muted = true;
            document.getElementById('videoOverlay').style.display = 'none';

            if (socket) socket.emit('create-room', { room, identity: userIdentity });
            setupUI('Host');

            localStream.getVideoTracks()[0].onended = () => {
                if (socket) socket.emit('end-session', { room: currentRoom });
                resetSession();
            };

        } catch (err) {
            alert("Screen sharing permission denied or cancelled.");
        }
    };

    // Viewer Action
    document.getElementById('joinRoomBtn').onclick = () => {
        const room = document.getElementById('joinRoomInput').value.trim();
        if (!room) return alert('Enter room code');
        currentRoom = room;
        isHostUser = false;

        setupUI('Viewer');
        initPeerConnection();

        if (socket) socket.emit('join-room', { room, identity: userIdentity });
    };

    // End Session Handler
    document.getElementById('endSessionBtn').onclick = () => {
        if (!currentRoom || !isHostUser) return;
        if (confirm("End session for everyone?")) {
            if (socket) socket.emit('end-session', { room: currentRoom });
            resetSession();
        }
    };

    // Chat Handler
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
        chatForm.onsubmit = (e) => {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            const text = input.value.trim();
            if (!text || !currentRoom) return;

            if (socket) socket.emit('send-chat-message', { room: currentRoom, sender: userIdentity, text });
            input.value = '';
        };
    }
});

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
}

function setupUI(role) {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('theater-page').classList.remove('hidden');
    document.getElementById('roleBadge').innerText = `${role} (${userIdentity})`;

    const endBtn = document.getElementById('endSessionBtn');
    if (isHostUser) {
        endBtn.classList.remove('hidden');
    } else {
        endBtn.classList.add('hidden');
    }
}

function initPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { room: currentRoom, signal: { candidate: event.candidate } });
        }
    };

    peerConnection.ontrack = (event) => {
    const videoElem = document.getElementById('remoteVideo');
    if (videoElem.srcObject !== event.streams[0]) {
        videoElem.srcObject = event.streams[0];
        
        // Host stays muted to prevent echo; viewer gets unmuted stream
        videoElem.muted = isHostUser;

        // Force video play to bypass browser autoplay restrictions
        videoElem.play().then(() => {
            document.getElementById('videoOverlay').style.display = 'none';
        }).catch((err) => {
            console.log("Autoplay blocked. User tap needed:", err);
            // Show overlay/button so viewer can tap to play manually
            const overlay = document.getElementById('videoOverlay');
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.innerText = 'Tap screen to play video';
                overlay.onclick = () => {
                    videoElem.play();
                    overlay.style.display = 'none';
                };
            }
        });
    }
};
}

async function initiateOffer() {
    initPeerConnection();
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { room: currentRoom, signal: { sdp: peerConnection.localDescription } });
}

async function handleSignal(signal) {
    initPeerConnection();

    if (signal.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        
        while (iceCandidateQueue.length > 0) {
            const candidate = iceCandidateQueue.shift();
            await peerConnection.addIceCandidate(candidate);
        }

        if (signal.sdp.type === 'offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { room: currentRoom, signal: { sdp: peerConnection.localDescription } });
        }
    } else if (signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            await peerConnection.addIceCandidate(candidate);
        } else {
            iceCandidateQueue.push(candidate);
        }
    }
}

function resetSession() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    iceCandidateQueue = [];
    const videoElem = document.getElementById('remoteVideo');
    videoElem.srcObject = null;
    videoElem.muted = false;
    document.getElementById('videoOverlay').style.display = 'flex';

    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('hostRoomInput').value = '';
    document.getElementById('joinRoomInput').value = '';

    currentRoom = null;
    isHostUser = false;

    document.getElementById('theater-page').classList.add('hidden');
    document.getElementById('landing-page').classList.remove('hidden');
}

function renderChatMessage({ sender, text }) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="sender">${sender}:</span><span>${text}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
