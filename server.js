require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Telegraf } = require('telegraf');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let bot = null;
if (process.env.BOT_TOKEN) {
    bot = new Telegraf(process.env.BOT_TOKEN);
}

// ID пользователей
const boyId = Number(process.env.BOYFRIEND_ID);
const girlIdReal = Number(process.env.GIRLFRIEND_ID);
const girlIdTest = Number(process.env.GIRLFRIEND_ID_TEST) || girlIdReal;
const girlIds = [girlIdReal, girlIdTest];

const activeUsers = new Map();
const messageQueue = { boy: [], girl: [] };
const photos = { boy: [], girl: [] };

let counters = { hugs: 0, love: 0, flowers: 0, hands: 0, songs: 0, compliments: 0, miss: 0, goodnight: 0 };

const timeCapsules = { boy: [], girl: [] };
let drawingData = [];

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (bot) {
    bot.on('photo', async (ctx) => {
        const userId = ctx.from.id;
        const photo = ctx.message.photo;
        const largestPhoto = photo[photo.length - 1];
        const fileId = largestPhoto.file_id;
        
        if (userId === boyId) {
            photos.boy.push(fileId);
            await ctx.reply('📸 Фото сохранено!');
        } else if (girlIds.includes(userId)) {
            photos.girl.push(fileId);
            await ctx.reply('📸 Фото сохранено!');
        }
    });
}

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('register', (telegramId) => {
        activeUsers.set(telegramId, socket);
        
        if (telegramId === boyId && messageQueue.boy.length > 0) {
            const queue = [...messageQueue.boy];
            messageQueue.boy = [];
            socket.emit('queued_messages', queue);
        } else if (girlIds.includes(telegramId) && messageQueue.girl.length > 0) {
            const queue = [...messageQueue.girl];
            messageQueue.girl = [];
            socket.emit('queued_messages', queue);
        }
        
        socket.emit('stats_update', counters);
        socket.emit('drawing_init', drawingData);
    });

    socket.on('send_hug', (data) => {
        const { senderId, receiverId, hugType } = data;
        
        const counterMap = {
            'hug': 'hugs',
            'love': 'love',
            'flower': 'flowers',
            'hand': 'hands',
            'song': 'songs',
            'compliment': 'compliments',
            'miss': 'miss',
            'goodnight': 'goodnight'
        };
        
        const counterKey = counterMap[hugType] || hugType;
        if (counters[counterKey] !== undefined) {
            counters[counterKey]++;
        }
        
        const receiverSocket = activeUsers.get(receiverId);
        if (receiverSocket) {
            receiverSocket.emit('receive_hug', { type: hugType, from: senderId, timestamp: Date.now() });
        } else {
            if (receiverId === boyId) {
                messageQueue.boy.push({ type: hugType, from: senderId, timestamp: Date.now() });
            } else if (girlIds.includes(receiverId)) {
                messageQueue.girl.push({ type: hugType, from: senderId, timestamp: Date.now() });
            }
        }
        
        socket.emit('hug_sent', { success: true });
        io.emit('stats_update', counters);
    });

    socket.on('get_photo', async (data) => {
        const { requesterId } = data;
        let photoList = [];
        let receiverId = null;
        
        if (requesterId === boyId) {
            photoList = photos.girl;
            receiverId = boyId;
        } else if (girlIds.includes(requesterId)) {
            photoList = photos.boy;
            receiverId = requesterId;
        }
        
        if (photoList.length === 0) {
            socket.emit('photo_result', { success: false, message: 'Пока нет фотографий.' });
            return;
        }
        
        const randomPhoto = photoList[Math.floor(Math.random() * photoList.length)];
        if (bot) {
            try {
                await bot.telegram.sendPhoto(receiverId, randomPhoto);
                socket.emit('photo_result', { success: true, message: 'Фото отправлено в чат!' });
            } catch (err) {
                socket.emit('photo_result', { success: false, message: 'Не удалось отправить фото.' });
            }
        }
    });

    socket.on('create_capsule', (data) => {
        const { senderId, receiverId, message, openDate } = data;
        const capsule = {
            id: Date.now(),
            from: senderId,
            to: receiverId,
            message: message,
            openDate: openDate,
            createdAt: Date.now(),
            opened: false
        };
        
        if (receiverId === boyId) timeCapsules.boy.push(capsule);
        else if (girlIds.includes(receiverId)) timeCapsules.girl.push(capsule);
        
        socket.emit('capsule_created', { success: true });
    });

    socket.on('draw', (data) => {
        drawingData.push(data);
        socket.broadcast.emit('draw', data);
    });

    socket.on('clear_drawing', () => {
        drawingData = [];
        io.emit('drawing_cleared');
    });

    socket.on('disconnect', () => {
        for (const [id, s] of activeUsers.entries()) {
            if (s === socket) {
                activeUsers.delete(id);
                break;
            }
        }
    });
});

if (bot) {
    bot.start((ctx) => {
        ctx.reply(
            'Привет! Я бот для вашего приложения «Наши объятия».\n\n' +
            '📸 Отправь мне фото, и оно сохранится.\n' +
            `Твой Telegram ID: ${ctx.from.id}`
        );
    });
    bot.launch();
    console.log('Bot started');
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

process.once('SIGINT', () => { if (bot) bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { if (bot) bot.stop('SIGTERM'); server.close(); });
