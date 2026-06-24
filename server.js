const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// مسارات ملفات الحفظ الدائم داخل السيرفر
const USERS_FILE = path.join(__dirname, 'users.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');

// دالات إدارة الحفظ التلقائي في ملفات الـ JSON
function loadData() {
    let users = {}, groups = {};
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(GROUPS_FILE)) {
        groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    }
    return { users, groups };
}

function saveData(users, groups) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf8');
}

// قراءة البيانات المحفوظة عند التشغيل
let { users, groups } = loadData();
let usersById = {};

function rebuildIdCache() {
    usersById = {};
    Object.values(users).forEach(u => { usersById[u.id] = u; });
}
rebuildIdCache();

function generateNumericId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

const messagesHistory = []; 

// ==== واجهات برمجية التطبيق (APIs) ====

app.post('/api/register', (req, res) => {
    const { username, password, name } = req.body;
    if (!username || !password || !name) return res.json({ success: false, error: "يرجى ملء جميع الحقول" });
    if (users[username]) return res.json({ success: false, error: "اسم المستخدم محجوز" });

    const userId = generateNumericId();
    const newUser = {
        id: userId, username, password, name,
        avatar: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        friends: [], groups: []
    };
    
    users[username] = newUser;
    saveData(users, groups); 
    rebuildIdCache();
    
    res.json({ success: true, user: newUser, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    let user = users[username] || usersById[username];
    if (!user || user.password !== password) return res.json({ success: false, error: "بيانات الدخول خاطئة" });
    res.json({ success: true, user, username: user.username });
});

app.get('/api/user/:id', (req, res) => {
    const user = usersById[req.params.id];
    if (user) res.json({ success: true, user: { id: user.id, name: user.name, avatar: user.avatar } });
    else res.json({ success: false, error: "لم يتم العثور على المستخدم" });
});

app.post('/api/add-friend', (req, res) => {
    const { myUsername, friendId } = req.body;
    const me = users[myUsername];
    const friend = usersById[friendId];
    if (!me || !friend) return res.json({ success: false, error: "خطأ بالإضافة" });

    if (!me.friends.includes(friendId)) me.friends.push(friendId);
    if (!friend.friends.includes(me.id)) friend.friends.push(me.id);
    
    saveData(users, groups); 
    res.json({ success: true, updatedUser: me });
});

app.post('/api/update-profile', (req, res) => {
    const { username, name, avatar } = req.body;
    const user = users[username];
    if (!user) return res.json({ success: false, error: "المستخدم غير موجود" });
    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    
    saveData(users, groups); 
    rebuildIdCache();
    res.json({ success: true, user });
});

app.post('/api/groups/create', (req, res) => {
    const { name, description, avatar, creatorId, creatorUsername } = req.body;
    const user = users[creatorUsername];
    if (!name || !user) return res.json({ success: false, error: "الاسم مطلوب" });

    const groupId = "g_" + Math.floor(1000 + Math.random() * 9000);
    const newGroup = {
        id: groupId, name, description: description || "لا يوجد وصف",
        avatar: avatar || "https://cdn-icons-png.flaticon.com/512/32/32441.png",
        members: [creatorId],
        roles: { [creatorId]: 'owner' } 
    };
    
    groups[groupId] = newGroup;
    if (!user.groups) user.groups = [];
    user.groups.push(groupId);
    
    saveData(users, groups); 
    res.json({ success: true, group: newGroup });
});

app.get('/api/user-groups/:userId', (req, res) => {
    const userId = req.params.userId;
    const userGroups = Object.values(groups).filter(g => g.members.includes(userId));
    res.json({ success: true, groups: userGroups });
});

app.get('/api/groups/details/:groupId', (req, res) => {
    const group = groups[req.params.groupId];
    if (!group) return res.json({ success: false, error: "الجروب غير موجود" });

    const membersInfo = group.members.map(mId => {
        const u = usersById[mId];
        return {
            id: mId,
            name: u ? u.name : "مستخدم غير معروف",
            avatar: u ? u.avatar : "https://cdn-icons-png.flaticon.com/512/149/149071.png",
            role: group.roles[mId] || 'member'
        };
    });
    res.json({ success: true, group, membersInfo });
});

app.post('/api/groups/update', (req, res) => {
    const { groupId, name, description, avatar, userId } = req.body;
    const group = groups[groupId];
    if (!group) return res.json({ success: false, error: "المجموعة غير موجودة" });

    const userRole = group.roles[userId];
    if (userRole !== 'owner' && userRole !== 'admin') {
        return res.json({ success: false, error: "ليس لديك صلاحية تعديل المجموعة" });
    }

    group.name = name;
    group.description = description;
    group.avatar = avatar;

    saveData(users, groups); 
    io.emit('group-updated', { groupId, name, avatar });
    res.json({ success: true });
});

app.post('/api/groups/change-role', (req, res) => {
    const { groupId, targetUserId, newRole, requestUserId } = req.body;
    const group = groups[groupId];
    if (!group) return res.json({ success: false, error: "المجموعة غير موجودة" });

    if (group.roles[requestUserId] !== 'owner') {
        return res.json({ success: false, error: "المالك فقط من يملك صلاحية إدارة الرتب" });
    }

    group.roles[targetUserId] = newRole;
    saveData(users, groups); 
    res.json({ success: true });
});

app.post('/api/groups/kick', (req, res) => {
    const { groupId, targetUserId, requestUserId } = req.body;
    const group = groups[groupId];
    if (!group) return res.json({ success: false, error: "المجموعة غير موجودة" });

    const myRole = group.roles[requestUserId];
    const targetRole = group.roles[targetUserId] || 'member';

    if (myRole !== 'owner' && myRole !== 'admin') {
        return res.json({ success: false, error: "لا تملك الصلاحية لطرد الأعضاء" });
    }
    if (myRole === 'admin' && targetRole !== 'member') {
        return res.json({ success: false, error: "كمشرف، لا يمكنك طرد المشرفين الآخرين أو المالك" });
    }

    group.members = group.members.filter(mId => mId !== targetUserId);
    if(group.roles[targetUserId]) delete group.roles[targetUserId];

    const targetUser = usersById[targetUserId];
    if(targetUser && targetUser.groups) {
        targetUser.groups = targetUser.groups.filter(gId => gId !== groupId);
    }

    saveData(users, groups); 
    io.emit('group-updated', { groupId, kickedId: targetUserId, name: group.name, avatar: group.avatar });
    res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
    const { fromId, toId, type } = req.query;
    let history = [];
    if (type === 'private') {
        history = messagesHistory.filter(msg => msg.type === 'private' && ((msg.fromId === fromId && msg.toId === toId) || (msg.fromId === toId && msg.toId === fromId)));
    } else if (type === 'group') {
        history = messagesHistory.filter(msg => msg.type === 'group' && msg.toId === toId);
    }
    res.json({ success: true, history });
});

io.on('connection', (socket) => {
    socket.on('join', (userId) => { socket.join(userId); });
    socket.on('send-message', (data) => {
        const messageObject = {
            fromId: data.fromId, fromName: data.fromName, toId: data.toId,
            message: data.message, type: data.type, fileType: data.fileType || 'text', timestamp: new Date()
        };
        messagesHistory.push(messageObject);

        if (data.type === 'private') {
            socket.to(data.toId).emit('receive-message', messageObject);
        } else if (data.type === 'group') {
            const group = groups[data.toId];
            if (group) {
                group.members.forEach(memberId => {
                    if (memberId !== data.fromId) socket.to(memberId).emit('receive-message', messageObject);
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("================================");
    console.log(`🚀 Revery Server is running!`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log("================================");
});

