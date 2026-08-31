require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Telegraf } = require('telegraf');
const fs = require('fs');

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

// Хранилище фотографий
const photos = {
    boy: [],   // Фото парня
    girl: []   // Фото девушки
};

// Загружаем сохранённые фото (если есть)
try {
    if (fs.existsSync('photos.json')) {
        const data = JSON.parse(fs.readFileSync('photos.json', 'utf8'));
        photos.boy = data.boy || [];
        photos.girl = data.girl || [];
    }
} catch (err) {
    console.error('Error loading photos:', err.message);
}

// Сохранение фото
function savePhotos() {
    try {
        fs.writeFileSync('photos.json', JSON.stringify(photos));
    } catch (err) {
        console.error('Error saving photos:', err.message);
    }
}

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
        'flower': '💐 Тебе подарили красивый букет!',
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

// Обработка получения фото от пользователя
if (bot) {
    bot.on('photo', async (ctx) => {
        const userId = ctx.from.id;
        const photo = ctx.message.photo;
        
        // Берём самое большое фото
        const largestPhoto = photo[photo.length - 1];
        const fileId = largestPhoto.file_id;
        
        // Определяем, кто отправил
        const boyId = Number(process.env.BOYFRIEND_ID);
        const girlId = Number(process.env.GIRLFRIEND_ID);
        
        if (userId === boyId) {
            photos.boy.push(fileId);
            savePhotos();
            await ctx.reply('📸 Фото сохранено! Теперь твоя девушка может увидеть его, нажав на кнопку «Фото» в приложении.');
        } else if (userId === girlId) {
            photos.girl.push(fileId);
            savePhotos();
            await ctx.reply('📸 Фото сохранено! Теперь твой парень может увидеть его, нажав на кнопку «Фото» в приложении.');
        } else {
            await ctx.reply('Я тебя не знаю. Ты не парень и не девушка из этого приложения.');
        }
    });
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

    // Получение случайного фото
    socket.on('get_photo', async (data) => {
        const { requesterId } = data;
        const boyId = Number(process.env.BOYFRIEND_ID);
        const girlId = Number(process.env.GIRLFRIEND_ID);
        
        let photoList = [];
        let receiverId = null;
        
        if (requesterId === boyId) {
            // Парень запрашивает фото девушки
            photoList = photos.girl;
            receiverId = boyId;
        } else if (requesterId === girlId) {
            // Девушка запрашивает фото парня
            photoList = photos.boy;
            receiverId = girlId;
        }
        
        if (photoList.length === 0) {
            socket.emit('photo_result', { 
                success: false, 
                message: 'Пока нет фотографий. Отправь фото боту, чтобы оно появилось здесь!' 
            });
            return;
        }
        
        // Выбираем случайное фото
        const randomPhoto = photoList[Math.floor(Math.random() * photoList.length)];
        
        // Отправляем фото через бота
        if (bot) {
            try {
                await bot.telegram.sendPhoto(receiverId, randomPhoto);
                socket.emit('photo_result', { 
                    success: true, 
                    message: 'Фото отправлено в чат!' 
                });
            } catch (err) {
                console.error('Photo send error:', err.message);
                socket.emit('photo_result', { 
                    success: false, 
                    message: 'Не удалось отправить фото. Попробуй ещё раз.' 
                });
            }
        } else {
            socket.emit('photo_result', { 
                success: false, 
                message: 'Бот недоступен.' 
            });
        }
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
    bot.start((ctx) => {
        ctx.reply(
            'Привет! Я бот для вашего приложения «Наши объятия».\n\n' +
            '📸 Отправь мне фото, и оно сохранится. Когда захочешь увидеть фото любимого человека, нажми кнопку «Фото» в приложении.\n\n' +
            `Твой Telegram ID: ${ctx.from.id}`
        );
    });
    
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
