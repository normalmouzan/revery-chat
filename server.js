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

let db = { users: {}, groups: {} };
if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(data || '{}');
        db.users = parsed.users || parsed;
        db.groups = parsed.groups || {};
    } catch (e) {
        db = { users: {}, groups: {} };
    }
} else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function save() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ====== Middleware ======
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== تسجيل حساب ======
app.post('/api/register', (req, res) => {
    const { username, password, name } = req.body;
    if (!username || !password || !name) return res.json({ success: false, error: 'جميع الحقول مطلوبة' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.json({ success: false, error: 'اسم المستخدم: أحرف إنجليزية وأرقام و (_) فقط' });
    
    const lowerUsername = username.trim().toLowerCase();
    if (db.users[lowerUsername]) return res.json({ success: false, error: 'اسم المستخدم موجود بالفعل' });
    
    const id = String(Math.floor(10000 + Math.random() * 90000));
    db.users[lowerUsername] = {
        name: name, password: password, id: id,
        avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
        friends: [], groups: [], bg: '#0a0a0a', neon: '#00ff41', messages: 0, online: false
    };
    save();
    res.json({ success: true, user: db.users[lowerUsername] });
});

// ====== تسجيل دخول ======
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const searchKey = username.trim().toLowerCase();
    let foundUser = null; let foundKey = null;
    
    if (db.users[searchKey]) {
        foundUser = db.users[searchKey]; foundKey = searchKey;
    } else {
        for (let u in db.users) {
            if (db.users[u].id === username.trim()) {
                foundUser = db.users[u]; foundKey = u; break;
            }
        }
    }
    if (!foundUser || foundUser.password !== password) return res.json({ success: false, error: 'بيانات الدخول غير صحيحة' });
    foundUser.online = true;
    save();
    res.json({ success: true, user: foundUser, username: foundKey });
});

// ====== بحث ذكي ======
app.get('/api/user/:query', (req, res) => {
    let query = req.params.query.trim().toLowerCase();
    
    for (let u in db.users) {
        if (db.users[u].id === query || u === query) {
            return res.json({ success: true, user: { name: db.users[u].name, id: db.users[u].id, avatar: db.users[u].avatar } });
        }
    }
    res.json({ success: false, error: 'لم يتم العثور على المستخدم' });
});

// ====== إضافة صديق ======
app.post('/api/add-friend', (req, res) => {
    const { myUsername, friendId } = req.body;
    const me = db.users[myUsername];
    if (!me) return res.json({ success: false, error: 'مستخدم غير موجود' });
    
    let friendUser = null;
    for (let u in db.users) {
        if (db.users[u].id === friendId) { friendUser = db.users[u]; break; }
    }
    if (!friendUser) return res.json({ success: false, error: 'لم يتم العثور على الصديق' });
    
    if (!me.friends) me.friends = [];
    if (!friendUser.friends) friendUser.friends = [];

    if (!me.friends.includes(friendId)) me.friends.push(friendId);
    if (!friendUser.friends.includes(me.id)) friendUser.friends.push(me.id);
    save();
    res.json({ success: true, updatedUser: me });
});

// ====== 👥 إنشاء جروب جديد ======
app.post('/api/groups/create', (req, res) => {
    const { name, description, avatar, creatorId, creatorUsername } = req.body;
    if (!name || !creatorId) return res.json({ success: false, error: 'اسم المجموعة مطلوب' });

    const groupId = String(Math.floor(100000 + Math.random() * 900000));
    
    db.groups[groupId] = {
        id: groupId,
        name: name,
        description: description || 'لا يوجد وصف للمجموعة.',
        avatar: avatar || 'https://cdn-icons-png.flaticon.com/512/32/32441.png',
        creator: creatorId,   
        admins: [],          
        members: [creatorId]  
    };

    if (db.users[creatorUsername]) {
        if (!db.users[creatorUsername].groups) db.users[creatorUsername].groups = [];
        db.users[creatorUsername].groups.push(groupId);
    }

    save();
    res.json({ success: true, group: db.groups[groupId] });
});

// ====== 👥 إضافة عضو للجروب ======
app.post('/api/groups/add-member', (req, res) => {
    const { groupId, memberId } = req.body;
    let targetId = memberId.trim();

    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'المجموعة غير موجودة' });
    if (group.members.includes(targetId)) return res.json({ success: false, error: 'هذا المستخدم عضو بالفعل' });

    let userKey = null;
    for (let u in db.users) {
        if (db.users[u].id === targetId) { userKey = u; break; }
    }
    if (!userKey) return res.json({ success: false, error: 'المعرف الرقمي غير صحيح أو غير مسجل' });

    group.members.push(targetId);
    if (!db.users[userKey].groups) db.users[userKey].groups = [];
    if (!db.users[userKey].groups.includes(groupId)) db.users[userKey].groups.push(groupId);

    save();
    io.to(groupId).emit('group-updated', group);
    res.json({ success: true, group });
});

// ====== 👥 طرد عضو ======
app.post('/api/groups/kick-member', (req, res) => {
    const { groupId, targetId, myId } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'المجموعة غير موجودة' });

    const isCreator = group.creator === myId;
    const isAdmin = group.admins.includes(myId);

    if (!isCreator && !isAdmin) return res.json({ success: false, error: 'ليست لديك صلاحية طرد الأعضاء' });
    if (targetId === group.creator) return res.json({ success: false, error: 'لا يمكن طرد مالك الجروب الاصلي!' });

    group.members = group.members.filter(m => m !== targetId);
    group.admins = group.admins.filter(a => a !== targetId);

    for (let u in db.users) {
        if (db.users[u].id === targetId) {
            if (db.users[u].groups) db.users[u].groups = db.users[u].groups.filter(g => g !== groupId);
            break;
        }
    }

    save();
    io.to(groupId).emit('group-updated', group);
    io.emit('user-kicked-global', { groupId, targetId }); 
    res.json({ success: true, group });
});

// ====== 👑 تعيين / سحب إشراف ======
app.post('/api/groups/toggle-admin', (req, res) => {
    const { groupId, targetId, myId } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'المجموعة غير موجودة' });
    if (group.creator !== myId) return res.json({ success: false, error: 'المالك فقط من يملك صلاحية تعيين المشرفين' });

    if (group.admins.includes(targetId)) {
        group.admins = group.admins.filter(a => a !== targetId); 
    } else {
        group.admins.push(targetId); 
    }

    save();
    io.to(groupId).emit('group-updated', group);
    res.json({ success: true, group });
});

// ====== 👥 تعديل بيانات الجروب ======
app.post('/api/groups/update', (req, res) => {
    const { groupId, name, description, avatar } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'المجموعة غير موجودة' });

    if (name) group.name = name;
    if (description) group.description = description;
    if (avatar) group.avatar = avatar;

    save();
    io.to(groupId).emit('group-updated', group); 
    res.json({ success: true, group });
});

// ====== جلب جروبات مستخدم ======
app.get('/api/user-groups/:userId', (req, res) => {
    const userId = req.params.userId;
    let myGroups = [];
    for (let gId in db.groups) {
        if (db.groups[gId].members.includes(userId)) {
            myGroups.push(db.groups[gId]);
        }
    }
    res.json({ success: true, groups: myGroups });
});

// ====== جلب بيانات أعضاء جروب ======
app.get('/api/groups/:groupId/members', (req, res) => {
    const group = db.groups[req.params.groupId];
    if (!group) return res.json({ success: false, error: 'الجروب غير موجود' });
    
    let membersDetails = [];
    group.members.forEach(mId => {
        for (let u in db.users) {
            if (db.users[u].id === mId) {
                let role = 'عضو';
                if (mId === group.creator) role = 'المالك 👑';
                else if (group.admins.includes(mId)) role = 'مشرف 🛡️';
                
                membersDetails.push({ id: mId, name: db.users[u].name, avatar: db.users[u].avatar, role: role });
                break;
            }
        }
    });
    res.json({ success: true, members: membersDetails, creator: group.creator, admins: group.admins });
});

// ====== تحديث الملف الشخصي ======
app.post('/api/update-profile', (req, res) => {
    const { username, name, avatar } = req.body;
    if (db.users[username]) {
        if (name) db.users[username].name = name;
        if (avatar) db.users[username].avatar = avatar; 
        save();
        return res.json({ success: true, user: db.users[username] });
    }
    res.json({ success: false });
});

// ====== Socket.io ======
const connectedUsers = {}; 

io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.userId = userId;
        connectedUsers[userId] = socket.id;
        
        for (let gId in db.groups) {
            if (db.groups[gId].members.includes(userId)) {
                socket.join(gId);
            }
        }
        for (let u in db.users) {
            if (db.users[u].id === userId) { db.users[u].online = true; save(); break; }
        }
    });
    
    socket.on('send-message', (data) => {
        const { toId, message, fromId, fromName, type } = data;
        if (type === 'group') {
            // الإرسال للجميع داخل غرفة الجروب بما فيهم المرسل للتحقق الموحد
            io.to(toId).emit('receive-message', { fromId, fromName, message, toId, type: 'group' });
        } else {
            // محادثة خاصة (تُرسل للمستلم وللمرسل نفسه لتحديث الأجهزة المزامنة)
            const targetSocketId = connectedUsers[toId];
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive-message', { fromId, fromName, message, toId: fromId, type: 'private' });
            }
            socket.emit('receive-message', { fromId, fromName, message, toId: toId, type: 'private' });
        }
    });

    socket.on('join-group-room', (groupId) => { socket.join(groupId); });
    
    socket.on('disconnect', () => {
        if (socket.userId) {
            for (let u in db.users) {
                if (db.users[u].id === socket.userId) { db.users[u].online = false; save(); break; }
            }
            delete connectedUsers[socket.userId];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`╔════════════════════════════╗\n║        🚀 Revery           ║\n║  http://localhost:${PORT}    ║\n╚════════════════════════════╝`);
});

