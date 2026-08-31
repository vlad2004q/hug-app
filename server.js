require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const bot = new Telegraf(process.env.BOT_TOKEN);

// Храним активные сокеты по Telegram ID
const activeUsers = new Map(); // telegramId -> socket

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
        const senderId = data.senderId;
        const receiverId = data.receiverId;
        const hugType = data.hugType;

        console.log(`Hug ${hugType} from ${senderId} to ${receiverId}`);

        // Если получатель онлайн
        const receiverSocket = activeUsers.get(receiverId);
        if (receiverSocket) {
            receiverSocket.emit('receive_hug', {
                type: hugType,
                from: senderId,
                timestamp: Date.now()
            });
        }

        // Отправляем уведомление через бота
        const messageText = getHugMessage(hugType, senderId);
        bot.telegram.sendMessage(receiverId, messageText, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '💞 Обнять в ответ', web_app: { url: 'https://hug-app.onrender.com/' } }
                ]]
            }
        }).catch(err => console.error('Bot send error:', err.message));

        socket.emit('hug_sent', { success: true, to: receiverId });
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

function getHugMessage(type, senderId) {
    const senderName = senderId == process.env.BOYFRIEND_ID ? 'Твой парень' : 'Твоя девушка';
    switch(type) {
        case 'hug': return `🤗 ${senderName} крепко тебя обнимает!`;
        case 'kiss': return `💋 ${senderName} шлёт тебе поцелуй!`;
        case 'tickle': return `🪶 ${senderName} тебя щекочет!`;
        case 'hand': return `🫳 ${senderName} тянет тебя за руку!`;
        default: return `💖 ${senderName} отправил(а) тебе нежность!`;
    }
}

// Команда /start
bot.start((ctx) => ctx.reply(`Твой Telegram ID: ${ctx.from.id}`));

// Запуск бота
// Запускаем бота только если это не Render или если это первый инстанс
if (process.env.RENDER && process.env.RENDER_INSTANCE_COUNT > 1) {
    console.log('Render multi-instance mode: bot polling disabled');
} else {
    bot.launch();
    console.log('Bot polling started');
}

// Запуск сервера
server.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});
