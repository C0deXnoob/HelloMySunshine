let socket = null;
let currentRoom = null;
let userIdentity = "Your Bubu";
let jitsiApi = null;

// Attach event listeners after DOM content loads
document.addEventListener("DOMContentLoaded", () => {
    
    // Connect Socket.io
    try {
        socket = io("https://hellomysunshine.onrender.com");
        
        socket.on('error-msg', (msg) => alert(msg));
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
    } catch (e) {
        console.error("Socket Connection Error:", e);
    }

    // Identity Selectors
    document.getElementById('btnBubu').addEventListener('click', () => selectIdentity('Your Bubu'));
    document.getElementById('btnDudu').addEventListener('click', () => selectIdentity('Your Dudu'));

    // Room Host/Join Action Handlers
    document.getElementById('startMovieBtn').onclick = () => {
        const room = document.getElementById('hostRoomInput').value.trim();
        if (!room) return alert('Enter a room code');
        currentRoom = room;
        
        if (socket) socket.emit('create-room', { room, identity: userIdentity });
        setupUI('Host');
        initJitsi(room);
    };

    document.getElementById('joinRoomBtn').onclick = () => {
        const room = document.getElementById('joinRoomInput').value.trim();
        if (!room) return alert('Enter room code');
        currentRoom = room;
        
        if (socket) socket.emit('join-room', { room, identity: userIdentity });
        setupUI('Viewer');
        initJitsi(room);
    };

    // Chat Handler
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
        chatForm.onsubmit = (e) => {
            e.preventDefault();
            const chatInput = document.getElementById('chatInput');
            const text = chatInput.value.trim();
            if (!text || !currentRoom) return;

            const msgData = { room: currentRoom, sender: userIdentity, text };
            if (socket) socket.emit('send-chat-message', msgData);
            chatInput.value = '';
        };
    }
});

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
}

function initJitsi(roomName) {
    const domain = 'meet.jit.si';
    const safeRoom = `CodexNoobWatchparty_${roomName.replace(/\s+/g, '_')}`;

    const options = {
        roomName: safeRoom,
        width: '100%',
        height: '100%',
        parentNode: document.querySelector('#jitsi-container'),
        userInfo: {
            displayName: userIdentity
        },
        configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            prejoinPageEnabled: false
        },
        interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [
                'microphone', 'camera', 'desktop', 'fullscreen', 'tileview'
            ],
            SHOW_JITSI_WATERMARK: false
        }
    };

    jitsiApi = new JitsiMeetExternalAPI(domain, options);
}

function setupUI(role) {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('theater-page').classList.remove('hidden');
    document.getElementById('roleBadge').innerText = `${role} (${userIdentity})`;
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
