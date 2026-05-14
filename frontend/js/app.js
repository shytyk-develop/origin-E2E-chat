// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let socket = null;
let myUsername = null;
let myKeys = null; // Здесь будут лежать { privateKey, publicKey }
let currentTargetUser = null; // Кому мы сейчас пишем
let usersDirectory = {}; // Справочник: { "Боб": { publicKey: JWK_Object } }

// Элементы UI
const loginModal = document.getElementById('loginModal');
const mainApp = document.getElementById('mainApp');
const statusSpan = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const usersListDiv = document.getElementById('usersList');
const chatWithTitle = document.getElementById('chatWithTitle');

// --- 1. ВХОД И ИНИЦИАЛИЗАЦИЯ ---
async function joinChat() {
    const inputName = document.getElementById('usernameInput').value.trim();
    if (!inputName) return;
    myUsername = inputName;

    // Скрываем окно логина, показываем чат
    loginModal.classList.add('hidden');
    mainApp.classList.remove('hidden');

    // МАГИЯ КРИПТОГРАФИИ: Генерируем ключи ПРИ ВХОДЕ (функция из crypto.js)
    console.log("Генерируем ключи...");
    myKeys = await generateKeyPair();
    const exportedPublicKey = await exportPublicKey(myKeys.publicKey);

    // ПОДКЛЮЧАЕМСЯ К СЕРВЕРУ
    socket = new WebSocket("ws://localhost:8000/ws");

    socket.onopen = () => {
        statusSpan.textContent = "В сети";
        statusSpan.className = "text-green-500 text-sm";
        
        // Отправляем серверу наше имя и публичный ключ
        const joinMsg = {
            type: "join",
            username: myUsername,
            public_key: exportedPublicKey
        };
        socket.send(JSON.stringify(joinMsg));
    };

    socket.onmessage = handleServerMessage;
    
    socket.onclose = () => {
        statusSpan.textContent = "Отключен";
        statusSpan.className = "text-red-500 text-sm";
    };
}

// --- 2. ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ ---
async function handleServerMessage(event) {
    const data = JSON.parse(event.data);

    if (data.type === "users_list") {
        updateUsersList(data.users);
    } 
    else if (data.type === "message") {
        // Мы получили зашифрованное сообщение!
        console.log("Получена шифровка от:", data.from);
        
        try {
            // Превращаем массив цифр (из JSON) обратно в Uint8Array
            const encryptedBytes = new Uint8Array(data.content);
            
            // Расшифровываем СВОИМ приватным ключом
            const decryptedText = await decryptMessage(myKeys.privateKey, encryptedBytes);
            
            // Отрисовываем
            renderMessage(data.from, decryptedText, "incoming");
        } catch (e) {
            console.error("Ошибка расшифровки!", e);
            renderMessage(data.from, "[Не удалось расшифровать]", "incoming");
        }
    }
}

// --- 3. ИНТЕРФЕЙС И ОТПРАВКА ---
function updateUsersList(users) {
    usersDirectory = {};
    usersListDiv.innerHTML = "";

    users.forEach(user => {
        if (user.username === myUsername) return; // Себя не добавляем

        // Сохраняем публичный ключ в справочник
        usersDirectory[user.username] = user.public_key;

        const btn = document.createElement("button");
        btn.className = "w-full text-left p-2 hover:bg-slate-700 rounded transition-colors";
        btn.textContent = user.username;
        btn.onclick = () => selectUser(user.username);
        usersListDiv.appendChild(btn);
    });
}

function selectUser(username) {
    currentTargetUser = username;
    chatWithTitle.textContent = `Чат с: ${username}`;
    
    // Разблокируем поле ввода
    messageInput.disabled = false;
    sendBtn.disabled = false;
    sendBtn.className = "bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-semibold transition-colors text-white";
}

async function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentTargetUser) return;

    // 1. Берем публичный ключ получателя из справочника
    const targetPublicKeyJWK = usersDirectory[currentTargetUser];
    
    // 2. Импортируем его (превращаем JSON обратно в CryptoKey)
    const targetCryptoKey = await importPublicKey(targetPublicKeyJWK);

    // 3. Шифруем текст (функция из crypto.js)
    const encryptedBuffer = await encryptMessage(targetCryptoKey, text);
    
    // Превращаем ArrayBuffer в обычный массив чисел, чтобы JSON смог его проглотить
    const encryptedArray = Array.from(new Uint8Array(encryptedBuffer));

    // 4. Отправляем на сервер
    const packet = {
        type: "message",
        to: currentTargetUser,
        content: encryptedArray
    };
    socket.send(JSON.stringify(packet));

    // 5. Отрисовываем у себя
    renderMessage("Вы", text, "outgoing");
    messageInput.value = "";
}

function renderMessage(sender, text, type) {
    const msgElement = document.createElement("div");
    
    if (type === "outgoing") {
        msgElement.className = "bg-blue-600 p-2 rounded w-fit max-w-[80%] break-words self-end ml-auto text-right mb-2";
    } else {
        msgElement.className = "bg-slate-700 p-2 rounded w-fit max-w-[80%] break-words mb-2";
    }
    
    // Добавляем имя отправителя мелким шрифтом
    msgElement.innerHTML = `<div class="text-xs text-slate-300 mb-1">${sender}</div>${text}`;
    
    messagesDiv.appendChild(msgElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}