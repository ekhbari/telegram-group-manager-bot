const { createClient } = require('@vercel/kv'); // استيراد createClient

// تهيئة عميل Vercel KV
// سيتم سحب المتغيرات البيئية تلقائيًا بواسطة Vercel
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// -----------------------------------------------------------
// وظائف تحميل وحفظ البيانات
// -----------------------------------------------------------

async function getBannedUsers() {
    // Vercel KV يخزن البيانات كـ key-value. سنخزن 'banned_users' كمصفوفة.
    return (await kv.get('banned_users')) || [];
}

async function addBannedUser(userId) {
    const bannedUsers = await getBannedUsers();
    if (!bannedUsers.includes(userId)) {
        bannedUsers.push(userId);
        await kv.set('banned_users', bannedUsers);
    }
}

async function removeBannedUser(userId) {
    let bannedUsers = await getBannedUsers();
    bannedUsers = bannedUsers.filter(id => id !== userId);
    await kv.set('banned_users', bannedUsers);
}

async function getUsersData() {
    // سنخزن 'users_data' ككائن يربط user_id ببيانات المستخدم
    return (await kv.get('users_data')) || {};
}

async function saveUserData(userId, userData) {
    const usersData = await getUsersData();
    usersData[userId] = userData;
    await kv.set('users_data', usersData);
}

async function getGroups() {
    // سنخزن 'groups' ككائن متداخل: { owner_id: { group_name: { link: "...", status: "..." } } }
    return (await kv.get('groups')) || {};
}

async function addGroup(ownerId, groupName, groupLink, status) {
    const groups = await getGroups();
    if (!groups[ownerId]) {
        groups[ownerId] = {};
    }
    groups[ownerId][groupName] = { link: groupLink, name: groupName, status: status };
    await kv.set('groups', groups);
}

async function updateGroupStatus(ownerId, groupName, newStatus) {
    const groups = await getGroups();
    if (groups[ownerId] && groups[ownerId][groupName]) {
        groups[ownerId][groupName].status = newStatus;
        await kv.set('groups', groups);
    }
}

async function deleteGroup(ownerId, groupName) {
    const groups = await getGroups();
    if (groups[ownerId] && groups[ownerId][groupName]) {
        delete groups[ownerId][groupName];
        // إذا لم يتبق أي مجموعات لهذا المستخدم، يمكن حذف المفتاح الخاص به أيضًا
        if (Object.keys(groups[ownerId]).length === 0) {
            delete groups[ownerId];
        }
        await kv.set('groups', groups);
    }
}

async function getInProgress(chatId) {
    // سنخزن 'in_progress' ككائن يربط chat_id بالحالة الجارية
    const inProgress = await kv.get('in_progress_states');
    return inProgress ? inProgress[chatId] : null;
}

async function setInProgress(chatId, state) {
    const inProgress = (await kv.get('in_progress_states')) || {};
    inProgress[chatId] = state;
    await kv.set('in_progress_states', inProgress);
}

async function clearInProgress(chatId) {
    const inProgress = (await kv.get('in_progress_states')) || {};
    delete inProgress[chatId];
    await kv.set('in_progress_states', inProgress);
}


module.exports = {
    kv, // تصدير kv للمستخدم المباشر إذا لزم الأمر
    getBannedUsers,
    addBannedUser,
    removeBannedUser,
    getUsersData,
    saveUserData,
    getGroups,
    addGroup,
    updateGroupStatus,
    deleteGroup,
    getInProgress,
    setInProgress,
    clearInProgress
};
