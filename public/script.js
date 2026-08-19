let socket = null;
let currentRoom = null;
let userIdentity = "Your Bubu";
let isHostUser = false;

let peerConnection = null;
let localStream = null;
let iceCandidateQueue = [];
let makingOffer = false;
let isSettingRemoteAnswerPending = false;

const rtcConfig = {
    iceServers: [
        { urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302'
        ]},
        // Demo TURN service. For production, replace these with your own
        // TURN credentials through environment variables on the server.
        {
            urls: [
                'turn:openrelay.metered.ca:80',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelay',
            credential: 'openrelay'
        }
    ],
    iceCandidatePoolSize: 10
};

const $ = (id) => document.getElementById(id);

function setOverlay(text, clickable = false) {
    const overlay = $('videoOverlay');
    if (!overlay) return;
    overlay.textContent = text;
    overlay.style.display = 'flex';
    overlay.style.pointerEvents = clickable ? 'auto' : 'none';
}

function hideOverlay() {
    const overlay = $('videoOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
    }
}

function logConnectionState() {
    if (!peerConnection) return;
    console.log('[WebRTC]', {
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        iceGatheringState: peerConnection.iceGatheringState,
        signalingState: peerConnection.signalingState
    });
}

function attachRemoteStream(stream) {
    const video = $('remoteVideo');
    if (!video) return;

    video.srcObject = stream;
    video.muted = isHostUser;

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    console.log('[MEDIA] Remote video tracks:', videoTracks.length);
    console.log('[MEDIA] Remote audio tracks:', audioTracks.length);

    if (audioTracks.length === 0 && !isHostUser) {
        setOverlay('Video connected, but no audio was received. Host must share Tab Audio.', true);
    } else {
        setOverlay('Connected. Tap to play if needed.', true);
    }

    video.play().then(() => {
        hideOverlay();
    }).catch((err) => {
        console.warn('[MEDIA] Autoplay blocked:', err);
        setOverlay('▶ Tap here to play the movie', true);
    });
}

async function playRemoteVideo() {
    const video = $('remoteVideo');
    if (!video || !video.srcObject) return;
    try {
        await video.play();
        hideOverlay();
    } catch (err) {
        console.error('[MEDIA] Manual play failed:', err);
        setOverlay('Browser blocked playback. Tap again or check browser permissions.', true);
    }
}

function initPeerConnection() {
    if (peerConnection) return peerConnection;

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket && currentRoom) {
            socket.emit('signal', {
                room: currentRoom,
                signal: { candidate: event.candidate }
            });
        }
    };

    peerConnection.onicecandidateerror = (event) => {
        console.warn('[ICE] Candidate error:', event.errorCode, event.errorText, event.url);
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('[ICE] State:', peerConnection.iceConnectionState);
        logConnectionState();

        if (peerConnection.iceConnectionState === 'failed') {
            setOverlay('Connection failed. Try refreshing both devices and reconnecting.', true);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection:', peerConnection.connectionState);
        logConnectionState();

        if (peerConnection.connectionState === 'connected') {
            console.log('[WebRTC] Media connection established successfully.');
        }
        if (peerConnection.connectionState === 'failed') {
            setOverlay('WebRTC connection failed. A TURN server may be required.', true);
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log('[ICE] Gathering:', peerConnection.iceGatheringState);
    };

    peerConnection.onsignalingstatechange = () => {
        console.log('[WebRTC] Signaling:', peerConnection.signalingState);
    };

    peerConnection.ontrack = (event) => {
        const stream = event.streams && event.streams[0];
        if (stream) attachRemoteStream(stream);
    };

    peerConnection.onnegotiationneeded = async () => {
        // Only the host creates offers in this 1-host/1-viewer architecture.
        if (!isHostUser || !localStream || makingOffer) return;
        try {
            await createAndSendOffer();
        } catch (err) {
            console.error('[WebRTC] Negotiation failed:', err);
        }
    };

    return peerConnection;
}

function addLocalTracks() {
    if (!peerConnection || !localStream) return;

    const existingTrackIds = new Set(
        peerConnection.getSenders()
            .map(sender => sender.track && sender.track.id)
            .filter(Boolean)
    );

    localStream.getTracks().forEach(track => {
        if (!existingTrackIds.has(track.id)) {
            peerConnection.addTrack(track, localStream);
        }
    });
}

async function createAndSendOffer() {
    if (!isHostUser || !localStream || !socket || !currentRoom) return;
    initPeerConnection();
    addLocalTracks();

    if (makingOffer) return;
    makingOffer = true;
    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', {
            room: currentRoom,
            signal: { sdp: peerConnection.localDescription }
        });
    } finally {
        makingOffer = false;
    }
}

async function handleSignal(signal) {
    const pc = initPeerConnection();

    try {
        if (signal.sdp) {
            const description = new RTCSessionDescription(signal.sdp);
            await pc.setRemoteDescription(description);

            while (iceCandidateQueue.length) {
                const candidate = iceCandidateQueue.shift();
                await pc.addIceCandidate(candidate);
            }

            if (description.type === 'offer') {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('signal', {
                    room: currentRoom,
                    signal: { sdp: pc.localDescription }
                });
            }
            return;
        }

        if (signal.candidate) {
            const candidate = new RTCIceCandidate(signal.candidate);
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(candidate);
            } else {
                iceCandidateQueue.push(candidate);
            }
        }
    } catch (err) {
        console.error('[WebRTC] Signal handling error:', err);
    }
}

async function startScreenShare() {
    try {
        // IMPORTANT: For movie audio, select the movie browser tab and enable
        // "Share tab audio" in Chrome/Edge's sharing dialog.
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30, max: 60 },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true,
            systemAudio: 'include',
            surfaceSwitching: 'include'
        });

        const videoTracks = localStream.getVideoTracks();
        const audioTracks = localStream.getAudioTracks();
        console.log('[CAPTURE] Video tracks:', videoTracks.length);
        console.log('[CAPTURE] Audio tracks:', audioTracks.length);

        if (!videoTracks.length) {
            throw new Error('No screen video track was captured.');
        }

        const video = $('remoteVideo');
        video.srcObject = localStream;
        video.muted = true;
        video.play().catch(() => {});
        hideOverlay();

        if (!audioTracks.length) {
            console.warn('[CAPTURE] No screen/tab audio was captured. Select a Chrome/Edge tab and enable Share tab audio.');
        }

        videoTracks[0].onended = () => {
            if (currentRoom && socket) socket.emit('end-session', { room: currentRoom });
            resetSession(false);
        };

        audioTracks.forEach(track => {
            track.onended = () => console.log('[CAPTURE] Shared audio track ended.');
        });

        initPeerConnection();
        addLocalTracks();

        socket.emit('create-room', { room: currentRoom, identity: userIdentity });
        setupUI('Host');
        setOverlay('Waiting for your Bubu/Dudu to join...', false);
    } catch (err) {
        console.error('[CAPTURE] getDisplayMedia failed:', err);
        localStream = null;
        alert('Screen sharing was cancelled or blocked. Please allow screen sharing and try again.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        socket = io('https://hellomysunshine.onrender.com', {
            transports: ['websocket', 'polling'],
            reconnection: true
        });

        socket.on('connect', () => console.log('[Socket.IO] Connected:', socket.id));
        socket.on('disconnect', reason => console.warn('[Socket.IO] Disconnected:', reason));
        socket.on('connect_error', err => console.error('[Socket.IO] Connection error:', err));

        socket.on('viewer-count-update', count => {
            if ($('viewerCount')) $('viewerCount').innerText = count;
        });

        socket.on('chat-message', renderChatMessage);
        socket.on('chat-history', history => {
            if (!$('chatMessages')) return;
            $('chatMessages').innerHTML = '';
            history.forEach(renderChatMessage);
        });

        socket.on('session-ended', () => {
            alert('The session has ended.');
            resetSession(false);
        });

        socket.on('host-ready', async () => {
            console.log('[SIGNAL] Host is ready. Viewer will wait for offer.');
        });

        socket.on('viewer-joined', async () => {
            console.log('[SIGNAL] Viewer joined. Host creating offer.');
            if (isHostUser && localStream) {
                try {
                    // Fresh connection for the single viewer.
                    if (peerConnection) {
                        peerConnection.close();
                        peerConnection = null;
                    }
                    iceCandidateQueue = [];
                    await createAndSendOffer();
                } catch (err) {
                    console.error('[SIGNAL] Could not create offer:', err);
                }
            }
        });

        socket.on('signal', data => handleSignal(data.signal));
    } catch (e) {
        console.error('Socket connection setup error:', e);
    }

    $('btnBubu').onclick = () => selectIdentity('Your Bubu');
    $('btnDudu').onclick = () => selectIdentity('Your Dudu');

    $('startMovieBtn').onclick = async () => {
        const room = $('hostRoomInput').value.trim();
        if (!room) return alert('Enter a room code');
        if (!socket || !socket.connected) return alert('Connecting to server. Please try again in a moment.');
        currentRoom = room;
        isHostUser = true;
        await startScreenShare();
    };

    $('joinRoomBtn').onclick = () => {
        const room = $('joinRoomInput').value.trim();
        if (!room) return alert('Enter room code');
        if (!socket || !socket.connected) return alert('Connecting to server. Please try again in a moment.');

        currentRoom = room;
        isHostUser = false;
        iceCandidateQueue = [];
        initPeerConnection();
        setupUI('Viewer');
        setOverlay('Waiting for host to share screen...', false);
        socket.emit('join-room', { room, identity: userIdentity });
    };

    $('videoOverlay').onclick = playRemoteVideo;

    $('endSessionBtn').onclick = () => {
        if (!currentRoom || !isHostUser) return;
        if (confirm('End session for everyone?')) {
            socket.emit('end-session', { room: currentRoom });
            resetSession(false);
        }
    };

    const chatForm = $('chatForm');
    if (chatForm) {
        chatForm.onsubmit = e => {
            e.preventDefault();
            const input = $('chatInput');
            const text = input.value.trim();
            if (!text || !currentRoom) return;
            socket.emit('send-chat-message', {
                room: currentRoom,
                sender: userIdentity,
                text
            });
            input.value = '';
        };
    }
});

function selectIdentity(name) {
    userIdentity = name;
    $('identityModal').style.display = 'none';
    $('app').classList.remove('hidden');
}

function setupUI(role) {
    $('landing-page').classList.add('hidden');
    $('theater-page').classList.remove('hidden');
    $('roleBadge').innerText = `${role} (${userIdentity})`;
    $('endSessionBtn').classList.toggle('hidden', !isHostUser);
}

function resetSession(emitEnd = false) {
    if (emitEnd && currentRoom && socket) socket.emit('end-session', { room: currentRoom });

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
        peerConnection = null;
    }

    iceCandidateQueue = [];
    makingOffer = false;
    isSettingRemoteAnswerPending = false;

    const video = $('remoteVideo');
    video.pause();
    video.srcObject = null;
    video.muted = false;
    setOverlay('Waiting for Host to share screen...', false);

    $('chatMessages').innerHTML = '';
    $('hostRoomInput').value = '';
    $('joinRoomInput').value = '';

    currentRoom = null;
    isHostUser = false;
    $('theater-page').classList.add('hidden');
    $('landing-page').classList.remove('hidden');
}

function renderChatMessage({ sender, text }) {
    const chatMessages = $('chatMessages');
    if (!chatMessages) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';

    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = `${sender}:`;
    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    div.append(senderSpan, textSpan);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
