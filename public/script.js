const socket = io("https://hellomysunshine.onrender.com");
const DAILY_ROOM_URL = "https://codexnoob.daily.co/CodexNoobWatchparty";

let callFrame = null;
let currentRoom = null;
let isHost = false;
let userIdentity = "Your Bubu";

function selectIdentity(name) {
    userIdentity = name;
    document.getElementById('identityModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

// Initialize Daily Call Frame inside player container
function initDailyCall() {
    const container = document.querySelector('.player-container');
    container.innerHTML = ''; // Clear placeholders

    callFrame = DailyIframe.createFrame(container, {
        iframeStyle: {
            width: '100%',
            height: '100%',
            border: '0',
            borderRadius: '12px'
        },
        showLeaveButton: false,
        showFullscreenButton: true
    });

    callFrame.join({ 
        url: DAILY_ROOM_URL,
        userName: userIdentity
    });
}

// Room Controls
document.getElementById('startMovieBtn').onclick = () => {
    const room = document.getElementById('hostRoomInput').value.trim();
    if (!room) return alert('Enter a room code');
    currentRoom = room;
    isHost = true;
    socket.emit('create-room', { room, identity: userIdentity });
    setupUI('Host');
    initDailyCall();
};

document.getElementById('joinRoomBtn').onclick = () => {
    const room = document.getElementById('joinRoomInput').value.trim();
    if (!room) return alert('Enter room code');
    currentRoom = room;
    isHost = false;
    socket.emit('join-room', { room, identity: userIdentity });
    setupUI('Viewer');
    initDailyCall();
};

socket.on('error-msg', (msg) => alert(msg));
socket.on('viewer-count-update', (count) => {
    document.getElementById('viewerCount').innerText = count;
});

function setupUI(role) {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('theater-page').classList.remove('hidden');
    document.getElementById('roleBadge').innerText = `${role} (${userIdentity})`;

    if (role === 'Host') {
        document.getElementById('hostControls').classList.remove('hidden');
    } else {
        document.getElementById('viewerControls').classList.remove('hidden');
    }
}

// Daily Screen Share Engine
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopScreenBtn = document.getElementById('stopScreenBtn');

if (shareScreenBtn) {
    shareScreenBtn.onclick = async () => {
        if (callFrame) {
            await callFrame.startScreenShare();
            shareScreenBtn.classList.add('hidden');
            if (stopScreenBtn) stopScreenBtn.classList.remove('hidden');
        }
    };
}

if (stopScreenBtn) {
    stopScreenBtn.onclick = async () => {
        if (callFrame) {
            await callFrame.stopScreenShare();
            shareScreenBtn.classList.remove('hidden');
            stopScreenBtn.classList.add('hidden');
        }
    };
}

// Live Chat Engine
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

if (chatForm) {
    chatForm.onsubmit = (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text || !currentRoom) return;

        const msgData = { room: currentRoom, sender: userIdentity, text };
        socket.emit('send-chat-message', msgData);
        chatInput.value = '';
    };
}

socket.on('chat-message', (data) => renderChatMessage(data));
socket.on('chat-history', (history) => {
    chatMessages.innerHTML = '';
    history.forEach(msg => renderChatMessage(msg));
});

function renderChatMessage({ sender, text }) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="sender">${sender}:</span><span>${text}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
