require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Telegraf } = require('telegraf');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Определяем, где запущено
const isRender = process.env.RENDER === 'true' || process.env.RENDER === '1';

// Создаём бота только если есть токен
let bot = null;
if (process.env.BOT_TOKEN) {
    bot = new Telegraf(process.env.BOT_TOKEN);
}

// Активные пользователи
const activeUsers = new Map();

// Раздаём статику
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Функция для отправки уведомлений через бота
async function sendTelegramNotification(receiverId, hugType) {
    if (!bot) return;
    
    const messages = {
        'hug': '🤗 Тебя крепко обняли!',
        'hand': '🫱 Тебя держат за руку!',
        'flower': '🌸 Тебе подарили цветок!',
        'compliment': '💌 Тебе отправили комплимент!',
        'song': '🎵 Тебе отправили мелодию!'
    };
    
    try {
        await bot.telegram.sendMessage(receiverId, messages[hugType] || messages['hug'], {
            reply_markup: {
                inline_keyboard: [[
                    { text: '💞 Открыть приложение', web_app: { url: 'https://hug-app.onrender.com' } }
                ]]
            }
        });
        console.log(`Notification sent to ${receiverId}`);
    } catch (err) {
        console.error('Send error:', err.message);
    }
}

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

        // Отправляем уведомление через бота (если получатель офлайн)
        sendTelegramNotification(receiverId, hugType);

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

// Запуск бота
if (bot) {
    // Обработчик /start
    bot.start((ctx) => ctx.reply(`Твой Telegram ID: ${ctx.from.id}`));
    
    // Запускаем бота
    bot.launch();
    console.log('Bot started');
}

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.once('SIGINT', () => {
    if (bot) bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    if (bot) bot.stop('SIGTERM');
    server.close();
});
