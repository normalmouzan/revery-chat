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
    
    // التعديل هنا: تم تحويل الـ ID إلى أرقام فقط (بدون علامة #) لتجنب مشاكل المتصفحات أثناء البحث
    const id = String(Math.floor(10000 + Math.random() * 90000));
    
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

// ====== Socket.io ======
const connectedUsers = {};

io.on('connection', (socket) => {
    socket.on('login', (username) => {
        connectedUsers[username] = socket.id;
        if (users[username]) {
            users[username].online = true;
            save();
        }
        socket.username = username;
    });
    
    socket.on('send-message', (data) => {
        const { to, message } = data;
        
        let target = null;
        for (let u in users) {
            if (users[u].name === to || users[u].id === to) {
                target = u;
                break;
            }
        }
        
        if (target && connectedUsers[target]) {
            io.to(connectedUsers[target]).emit('new-message', {
                from: socket.username,
                message: message,
                time: new Date().toLocaleTimeString('ar-EG')
            });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) {
            users[socket.username].online = false;
            save();
        }
        delete connectedUsers[socket.username];
    });
});

// ====== تشغيل ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('╔════════════════════════════╗');
    console.log('║        🚀 Revery           ║');
    console.log('║  http://localhost:' + PORT + '    ║');
    console.log('║  http://0.0.0.0:' + PORT + '      ║');
    console.log('╚════════════════════════════╝');
});
