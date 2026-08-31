require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Определяем, где запущено
const isRender = process.env.RENDER === 'true' || process.env.RENDER === '1';

// Активные пользователи
const activeUsers = new Map();

// Раздаём статику
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка WebSocket
io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('register', (telegramId) => {
        activeUsers.set(telegramId, socket);
        console.log(`User ${telegramId} registered`);
    });

    socket.on('send_hug', (data) => {
        const { senderId, receiverId, hugType } = data;
        console.log(`Hug ${hugType} from ${senderId} to ${receiverId}`);

        // Отправляем через WebSocket, если получатель онлайн
        const receiverSocket = activeUsers.get(receiverId);
        if (receiverSocket) {
            receiverSocket.emit('receive_hug', {
                type: hugType,
                from: senderId,
                timestamp: Date.now()
            });
        }

        // Подтверждение отправителю
        socket.emit('hug_sent', { success: true });
    });

    socket.on('disconnect', () => {
        for (const [id, s] of activeUsers.entries()) {
            if (s === socket) {
                activeUsers.delete(id);
                console.log(`User ${id} disconnected`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
