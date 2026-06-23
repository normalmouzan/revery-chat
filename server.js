const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ====== قاعدة بيانات ======
const DB_FILE = path.join(__dirname, 'users.json');

let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        users = JSON.parse(data || '{}');
    } catch (e) {
        users = {};
    }
} else {
    fs.writeFileSync(DB_FILE, '{}');
}

function save() {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// ====== Middleware ======
app.use(express.static('public'));
app.use(express.json());

// ====== الصفحة الرئيسية ======
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== تسجيل ======
app.post('/api/register', (req, res) => {
    const { username, password, name } = req.body;
    
    if (!username || !password || !name) {
        return res.json({ success: false, error: 'جميع الحقول مطلوبة' });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.json({ success: false, error: 'اسم المستخدم: أحرف إنجليزية وأرقام و (_) فقط' });
    }
    
    if (username.length < 3) {
        return res.json({ success: false, error: 'اسم المستخدم لازم 3 أحرف على الأقل' });
    }
    
    if (users[username]) {
        return res.json({ success: false, error: 'اسم المستخدم موجود بالفعل' });
    }
    
    if (password.length < 6) {
        return res.json({ success: false, error: 'كلمة المرور لازم 6 أحرف على الأقل' });
    }
    
    const id = '#' + Math.floor(10000 + Math.random() * 90000);
    
    users[username] = {
        name: name,
        password: password,
        id: id,
        avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
        friends: [],
        blocked: [],
        bg: '#0a0a0a',
        neon: '#00ff41',
        messages: 0,
        online: false
    };
    
    save();
    
    res.json({ success: true, user: users[username] });
});

// ====== تسجيل دخول ======
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    let foundUser = null;
    let foundKey = null;
    
    if (users[username]) {
        foundUser = users[username];
        foundKey = username;
    } else {
        for (let u in users) {
            if (users[u].id === username) {
                foundUser = users[u];
                foundKey = u;
                break;
            }
        }
    }
    
    if (!foundUser) {
        return res.json({ success: false, error: 'المستخدم غير موجود' });
    }
    
    if (foundUser.password !== password) {
        return res.json({ success: false, error: 'كلمة المرور غير صحيحة' });
    }
    
    foundUser.online = true;
    save();
    
    res.json({ success: true, user: foundUser, username: foundKey });
});

// ====== بحث عن مستخدم ======
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    
    for (let u in users) {
        if (users[u].id === userId) {
            return res.json({
                success: true,
                user: {
                    name: users[u].name,
                    id: users[u].id,
                    avatar: users[u].avatar
                }
            });
        }
    }
    
    res.json({ success: false, error: 'لم يتم العثور' });
});

// ====== إضافة صديق ======
app.post('/api/add-friend', (req, res) => {
    const { myUsername, friendId } = req.body;
    
    if (!users[myUsername]) {
        return res.json({ success: false, error: 'مستخدم غير موجود' });
    }
    
    let found = false;
    for (let u in users) {
        if (users[u].id === friendId) {
            found = true;
            if (!users[myUsername].friends.includes(friendId)) {
                users[myUsername].friends.push(friendId);
                save();
            }
            break;
        }
    }
    
    if (!found) {
        return res.json({ success: false, error: 'لم يتم العثور' });
    }
    
    res.json({ success: true });
});

// ====== تحديث بروفايل ======
app.post('/api/update-profile', (req, res) => {
    const { username, name, bg, neon } = req.body;
    
    if (users[username]) {
        if (name) users[username].name = name;
        if (bg) users[username].bg = bg;
        if (neon) users[username].neon = neon;
        save();
    }
    
    res.json({ success: true });
});

// ====== [تعديل كامل هنا] Socket.io ======
const connectedUsers = {}; // بنخزن فيها الـ socket.id مفتاحها هو الـ ID الفريد للمستخدم (مثل #12345)

io.on('connection', (socket) => {
    
    // 1. عند دخول المستخدم للتطبيق يتم ربط الـ ID بتاعه بالـ socket.id الحالي
    socket.on('join', (userId) => {
        socket.userId = userId;
        connectedUsers[userId] = socket.id;
        
        // تحديث حالة المستخدم في قاعدة البيانات إلى "متصل"
        for (let u in users) {
            if (users[u].id === userId) {
                users[u].online = true;
                save();
                break;
            }
        }
    });
    
    // 2. استقبال الرسالة وتوجيهها للمستلم الحقيقي
    socket.on('send-message', (data) => {
        const { toId, message, fromId, fromName } = data;
        
        // البحث عن الـ socket.id الخاص بالشخص المستلم
        const targetSocketId = connectedUsers[toId];
        
        // زيادة عدد الرسائل المرسلة للمستخدم في قاعدة البيانات (اختياري للإحصائيات)
        for (let u in users) {
            if (users[u].id === fromId) {
                users[u].messages = (users[u].messages || 0) + 1;
                save();
                break;
            }
        }

        // لو الشخص المستلم فاتح التطبيق حالياً، نرسل له الرسالة فوراً
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive-message', {
                fromId: fromId,
                fromName: fromName,
                message: message
            });
        }
    });
    
    // 3. عند خروج المستخدم أو قفل الصفحة
    socket.on('disconnect', () => {
        if (socket.userId) {
            // تحديث حالته في الـ JSON ليكون غير متصل
            for (let u in users) {
                if (users[u].id === socket.userId) {
                    users[u].online = false;
                    save();
                    break;
                }
            }
            // حذف جلسة الاتصال
            delete connectedUsers[socket.userId];
        }
    });
});

// ====== تشغيل ======
const PORT = process.env.PORT || 3000;
server.listen(PORT,'0.0.0.0', () => {
    console.log('╔════════════════════════════╗');
    console.log('║        🚀 Revery           ║');
    console.log('║  http://localhost:' + PORT + '    ║');
    console.log('║  http://0.0.0.0:' + PORT + '      ║'); 
    console.log('╚════════════════════════════╝');
});

