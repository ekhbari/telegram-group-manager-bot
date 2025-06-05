const { Telegraf, Markup } = require('telegraf');
const { kv } = require('@vercel/kv'); // لاستخدام Vercel KV
const {
    saveUserData,
    getBannedUsers,
    addBannedUser,
    removeBannedUser,
    getUsersData,
    addGroup,
    getGroups,
    updateGroupStatus,
    setInProgress,
    getInProgress,
    clearInProgress
} = require('../utils/kv_store'); // وظائف التعامل مع Vercel KV

// يجب تعيين هذا كمتغير بيئة في Vercel (BOT_TOKEN)
const BOT_TOKEN = process.env.BOT_TOKEN;
// يجب تعيين هذا كمتغيرات بيئة في Vercel (ADMIN_ID_1, ADMIN_ID_2)
const ADMIN_ID_1 = process.env.ADMIN_ID_1; // ID المشرف الأول
const ADMIN_ID_2 = process.env.ADMIN_ID_2; // ID المشرف الثاني

const bot = new Telegraf(BOT_TOKEN);

// وظيفة مساعدة لإرسال الرسائل
const sendMessage = async (chatId, text, extra = {}) => {
    try {
        await bot.telegram.sendMessage(chatId, text, extra);
    } catch (error) {
        console.error(`Failed to send message to ${chatId}:`, error);
    }
};

// وظيفة مساعدة لتعديل الرسائل
const editMessageText = async (chatId, messageId, text, extra = {}) => {
    try {
        await bot.telegram.editMessageText(chatId, messageId, text, extra);
    } catch (error) {
        console.error(`Failed to edit message ${messageId} in ${chatId}:`, error);
    }
};

// وظيفة مساعدة لتعديل لوحة المفاتيح
const editMessageReplyMarkup = async (chatId, messageId, reply_markup) => {
    try {
        await bot.telegram.editMessageReplyMarkup(chatId, messageId, { reply_markup });
    } catch (error) {
        console.error(`Failed to edit reply markup for message ${messageId} in ${chatId}:`, error);
    }
};


// -----------------------------------------------------------
// الأوامر Commands
// -----------------------------------------------------------

bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const fromId = ctx.from.id;
    const bannedUsers = await getBannedUsers();

    if (bannedUsers.includes(fromId.toString())) {
        return sendMessage(chatId, "تم حظرك من البوت، لا يمكنك إرسال الطلبات.");
    }

    const userName = ctx.from.first_name;
    const userUsername = ctx.from.username;
    const userId = ctx.from.id.toString();

    // حفظ بيانات المستخدم
    const usersData = await getUsersData();
    if (!usersData[userId]) {
        await saveUserData(userId, { name: userName, username: userUsername, user_id: userId });
        // إرسال إشعار للمشرفين بوجود مستخدم جديد
        const adminMessage = `مستخدم جديد:\nاسم المستخدم: ${userName}\nاسم المستخدم في تيليجرام: @${userUsername || 'لا يوجد'}\nID: ${userId}`;
        if (ADMIN_ID_1) sendMessage(ADMIN_ID_1, adminMessage);
        if (ADMIN_ID_2) sendMessage(ADMIN_ID_2, adminMessage);
    }

    const keyboard = Markup.keyboard([
        ['أضف كروبك', 'بحث عن كروبات'],
        ['لوحة المطور'],
        ['مطور البوت', 'نبذة البوت']
    ]).resize().extra();

    await sendMessage(chatId, "مرحبًا يمكنك من هنا اضافة مجموعتك ويمكنك البحث عن مجموعة معينة بالأسم.", keyboard);
});

// -----------------------------------------------------------
// معالجة الرسائل النصية
// -----------------------------------------------------------

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const messageText = ctx.message.text;
    const bannedUsers = await getBannedUsers();
    const currentInProgress = await getInProgress(chatId);

    if (bannedUsers.includes(userId)) {
        return sendMessage(chatId, "تم حظرك من البوت، لا يمكنك إرسال الطلبات.");
    }

    // لوحة تحكم المطور
    if (messageText === 'لوحة المطور') {
        if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
            return sendMessage(chatId, "معندگ صلاحية فتح لوحة المطور .");
        }
        const adminKeyboard = Markup.keyboard([
            ['حظر مستخدم', 'إلغاء حظر مستخدم'],
            ['إرسال إذاعة'],
            ['عرض الكروبات', 'مسح مجموعة'],
            ['رجوع']
        ]).resize().extra();
        await sendMessage(chatId, "لوحة تحكم المطور :", adminKeyboard);
    } else if (messageText === 'رجوع' && (userId === ADMIN_ID_1 || userId === ADMIN_ID_2)) {
        await clearInProgress(chatId); // مسح أي حالة جارية
        const mainKeyboard = Markup.keyboard([
            ['أضف كروبك', 'بحث عن كروبات'],
            ['لوحة المطور'],
            ['مطور البوت', 'نبذة البوت']
        ]).resize().extra();
        await sendMessage(chatId, "مرحبًا بك مرة أخرى في القائمة الرئيسية.", mainKeyboard);
    }
    // معالجة طلبات الإذاعة
    else if (currentInProgress === 'broadcast') {
        await processBroadcast(ctx);
    }
    // معالجة حظر المستخدم
    else if (currentInProgress === 'ban_user') {
        await processBanUser(ctx);
    }
    // معالجة إلغاء حظر المستخدم
    else if (currentInProgress === 'unban_user') {
        await processUnbanUser(ctx);
    }
    // معالجة إضافة مجموعة
    else if (currentInProgress === 'add_group_name') {
        await processAddGroupName(ctx);
    }
    else if (currentInProgress && currentInProgress.startsWith('add_group_link:')) {
        await processAddGroupLink(ctx);
    }
    // معالجة البحث عن مجموعة
    else if (currentInProgress === 'search_group_name') {
        await processSearchGroup(ctx);
    }
    // معالجة مسح مجموعة
    else if (currentInProgress === 'delete_group_by_name') {
        await processDeleteGroup(ctx);
    }
});


// -----------------------------------------------------------
// معالجة الأزرار الداخلية (Callback Queries)
// -----------------------------------------------------------

bot.on('callback_query', async (ctx) => {
    const call = ctx.callbackQuery;
    const chatId = call.message.chat.id;
    const messageId = call.message.message_id;
    const userId = call.from.id.toString();
    const callData = call.data;
    const bannedUsers = await getBannedUsers();

    if (bannedUsers.includes(userId)) {
        return ctx.answerCbQuery("تم حظرك من البوت، لا يمكنك إرسال الطلبات.", true);
    }

    switch (callData) {
        case 'bot_about':
            await editMessageText(chatId, messageId, "مادري شكتب.", Markup.inlineKeyboard([
                Markup.button.callback('رجوع', 'back_to_main_menu_from_inline')
            ]));
            break;

        case 'back_to_main_menu_from_inline':
            const mainKeyboard = Markup.keyboard([
                ['أضف كروبك', 'بحث عن كروبات'],
                ['لوحة المطور'],
                ['مطور البوت', 'نبذة البوت']
            ]).resize().extra();
            await editMessageText(chatId, messageId, "مرحبًا يمكنك من هنا اضافة مجموعتك ويمكنك البحث عن مجموعة معينة بالأسم.", mainKeyboard);
            break;

        case 'admin_panel_inline': // زر لوحة المطور من القائمة الرئيسية
            if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
                return ctx.answerCbQuery("معندگ صلاحية فتح لوحة المطور .", true);
            }
            const adminKeyboard = Markup.keyboard([
                ['حظر مستخدم', 'إلغاء حظر مستخدم'],
                ['إرسال إذاعة'],
                ['عرض الكروبات', 'مسح مجموعة'],
                ['رجوع']
            ]).resize().extra();
            await editMessageText(chatId, messageId, "لوحة تحكم المطور :", adminKeyboard);
            await ctx.answerCbQuery();
            break;

        case 'show_groups':
            await showGroups(ctx);
            break;

        case 'ban_user':
            if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
                return ctx.answerCbQuery("معندگ صلاحية لحظر المستخدمين.", true);
            }
            await setInProgress(chatId, 'ban_user');
            await editMessageText(chatId, messageId, "أرسل لي معرف المستخدم (ID) الذي تريد حظره.", Markup.inlineKeyboard([
                Markup.button.callback('رجوع', 'admin_panel_inline')
            ]));
            break;

        case 'unban_user':
            if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
                return ctx.answerCbQuery("معندگ صلاحية لإلغاء حظر المستخدمين.", true);
            }
            await setInProgress(chatId, 'unban_user');
            await editMessageText(chatId, messageId, "أرسل لي معرف المستخدم (ID) الذي تريد إلغاء حظره.", Markup.inlineKeyboard([
                Markup.button.callback('رجوع', 'admin_panel_inline')
            ]));
            break;

        case 'broadcast':
            if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
                return ctx.answerCbQuery("معندك صلاحية تسوي إذاعة.", true);
            }
            await setInProgress(chatId, 'broadcast');
            await editMessageText(chatId, messageId, "ارسل الرسالة التي تريد إرسالها إلى جميع المستخدمين:", Markup.inlineKeyboard([
                Markup.button.callback('رجوع', 'admin_panel_inline')
            ]));
            break;

        case 'add_group': // زر "أضف كروبك"
            await setInProgress(chatId, 'add_group_name');
            await sendMessage(chatId, "دزلي هسه اسم مجموعتك .", Markup.inlineKeyboard([
                Markup.button.callback('إلغاء', 'cancel_operation')
            ]).extra());
            await ctx.answerCbQuery();
            break;

        case 'search_group': // زر "بحث عن كروبات"
            await setInProgress(chatId, 'search_group_name');
            await sendMessage(chatId, "دزلي هسه اسم الكروب حتى أبحث بقاعدة البيانات :", Markup.inlineKeyboard([
                Markup.button.callback('إلغاء', 'cancel_operation')
            ]).extra());
            await ctx.answerCbQuery();
            break;

        case 'delete_group': // زر "مسح مجموعة"
            if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
                return ctx.answerCbQuery("معندك صلاحية لمسح المجموعات.", true);
            }
            await setInProgress(chatId, 'delete_group_by_name');
            await sendMessage(chatId, "أرسل لي اسم المجموعة التي تريد مسحها.", Markup.inlineKeyboard([
                Markup.button.callback('رجوع', 'admin_panel_inline')
            ]).extra());
            await ctx.answerCbQuery();
            break;

        case 'cancel_operation':
            await clearInProgress(chatId);
            await editMessageText(chatId, messageId, "تم إلغاء العملية.", Markup.removeKeyboard().extra()); // إزالة الكيبورد المؤقت
            await bot.telegram.sendMessage(chatId, "مرحبًا يمكنك من هنا اضافة مجموعتك ويمكنك البحث عن مجموعة معينة بالأسم.", Markup.keyboard([
                ['أضف كروبك', 'بحث عن كروبات'],
                ['لوحة المطور'],
                ['مطور البوت', 'نبذة البوت']
            ]).resize().extra());
            break;

        default:
            // معالجة قبول ورفض المجموعات
            if (callData.startsWith('accept_') || callData.startsWith('reject_')) {
                await handleAcceptReject(ctx, callData);
            }
            break;
    }
});

// -----------------------------------------------------------
// وظائف معالجة الحالات
// -----------------------------------------------------------

async function processBanUser(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const userToBanId = ctx.message.text.trim();
    const bannedUsers = await getBannedUsers();

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        await sendMessage(chatId, "معندك صلاحية حظر المستخدمين.");
        await clearInProgress(chatId);
        return;
    }

    if (!/^\d+$/.test(userToBanId)) {
        await sendMessage(chatId, "غلط، دز معرف مستخدم صالح (أرقام فقط).");
        return; // لا تمسح الحالة، ننتظر ID صالح
    }

    if (bannedUsers.includes(userToBanId)) {
        await sendMessage(chatId, `المستخدم ${userToBanId} محظور بالفعل.`);
    } else if (userToBanId === ADMIN_ID_1 || userToBanId === ADMIN_ID_2) {
        await sendMessage(chatId, "انجب متكدر تحظر روحك .");
    } else {
        await addBannedUser(userToBanId);
        await sendMessage(chatId, `تم حظر المستخدم ${userToBanId}.`);
        await sendMessage(userToBanId, "تم حظرك من البوت. لا يمكنك إرسال أي طلبات بعد الآن.");
    }
    await clearInProgress(chatId);
}

async function processUnbanUser(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const userToUnbanId = ctx.message.text.trim();
    const bannedUsers = await getBannedUsers();

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        await sendMessage(chatId, "معندك صلاحية لإلغاء حظر المستخدمين.");
        await clearInProgress(chatId);
        return;
    }

    if (!/^\d+$/.test(userToUnbanId)) {
        await sendMessage(chatId, "عليك إدخال معرف مستخدم صحيح (أرقام فقط).");
        return; // لا تمسح الحالة، ننتظر ID صالح
    }

    if (!bannedUsers.includes(userToUnbanId)) {
        await sendMessage(chatId, `المستخدم ${userToUnbanId} غير محظور.`);
    } else {
        await removeBannedUser(userToUnbanId);
        await sendMessage(chatId, `تم إلغاء حظر المستخدم ${userToUnbanId}.`);
    }
    await clearInProgress(chatId);
}

async function processBroadcast(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const broadcastMessage = ctx.message.text;
    const usersData = await getUsersData();

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        await sendMessage(chatId, "معندك صلاحية تسوي إذاعة.");
        await clearInProgress(chatId);
        return;
    }

    await clearInProgress(chatId); // مسح حالة الإذاعة بعد تلقي الرسالة

    for (const id in usersData) {
        try {
            await sendMessage(id, broadcastMessage);
        } catch (e) {
            console.error(`Failed to send broadcast to ${id}:`, e);
            // قد يكون المستخدم حظر البوت
        }
    }
    await sendMessage(chatId, "تم إرسال الرسالة إلى جميع المستخدمين.");
}

async function processAddGroupName(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const groupName = ctx.message.text.trim();

    // تحقق من أن الاسم ليس فارغاً
    if (!groupName) {
        await sendMessage(chatId, "الرجاء إدخال اسم صحيح للمجموعة.");
        return;
    }

    // قم بتخزين اسم المجموعة مؤقتًا واطلب الرابط
    await setInProgress(chatId, `add_group_link:${groupName}`);
    await sendMessage(chatId, `حسناً، اسم المجموعة هو "${groupName}". الآن، دزلي رابط المجموعة (دعوة الانضمام).`);
}

async function processAddGroupLink(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const groupLink = ctx.message.text.trim();
    const currentInProgress = await getInProgress(chatId);

    // استخراج اسم المجموعة من حالة in_progress
    const groupName = currentInProgress.split(':')[1];

    if (!groupLink || !groupLink.startsWith('https://t.me/joinchat/') && !groupLink.startsWith('https://t.me/')) {
        await sendMessage(chatId, "الرجاء إدخال رابط دعوة صالح للمجموعة.");
        return;
    }

    await addGroup(userId, groupName, groupLink, "pending"); // الحالة الأولية "قيد الانتظار"
    await clearInProgress(chatId); // مسح حالة الإضافة

    await sendMessage(chatId, "تم استلام طلبك لإضافة المجموعة. سيتم مراجعته من قبل المشرفين.");

    // إرسال إشعار للمشرفين لقبول أو رفض المجموعة
    const adminMarkup = Markup.inlineKeyboard([
        [
            Markup.button.callback('قبول', `accept_${groupName}_${userId}`),
            Markup.button.callback('رفض', `reject_${groupName}_${userId}`)
        ]
    ]).extra();

    const adminMessage = `طلب جديد لإضافة مجموعة:\nاسم المجموعة: ${groupName}\nالرابط: ${groupLink}\nمن المستخدم ID: ${userId}`;
    if (ADMIN_ID_1) sendMessage(ADMIN_ID_1, adminMessage, adminMarkup);
    if (ADMIN_ID_2) sendMessage(ADMIN_ID_2, adminMessage, adminMarkup);
}

async function handleAcceptReject(ctx, callData) {
    const call = ctx.callbackQuery;
    const chatId = call.message.chat.id;
    const messageId = call.message.message_id;
    const userId = call.from.id.toString();

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        return ctx.answerCbQuery("معندك صلاحية للقيام بهذا الإجراء.", true);
    }

    const [action, groupName, ownerId] = callData.split('_');
    const ownerIdStr = ownerId.toString(); // تأكد أنه سترينج للمقارنة

    const bannedUsers = await getBannedUsers();
    if (bannedUsers.includes(ownerIdStr)) {
        await ctx.answerCbQuery("لا يمكن قبول/رفض طلب من مستخدم محظور.", true);
        await editMessageReplyMarkup(chatId, messageId, {}); // إزالة الأزرار
        return;
    }

    const groups = await getGroups();
    if (!groups[ownerIdStr] || !groups[ownerIdStr][groupName]) {
        await ctx.answerCbQuery("هذه المجموعة غير موجودة أو تم حذفها.", true);
        await editMessageReplyMarkup(chatId, messageId, {}); // إزالة الأزرار
        return;
    }

    if (action === 'accept') {
        await updateGroupStatus(ownerIdStr, groupName, "approved");
        await sendMessage(chatId, `تم قبول المجموعة : ${groupName} بنجاح .`);
        await sendMessage(ownerIdStr, `تهانينا! تم قبول مجموعتك "${groupName}" وهي الآن متاحة للبحث.`);
    } else if (action === 'reject') {
        await updateGroupStatus(ownerIdStr, groupName, "rejected");
        await sendMessage(chatId, `تم رفض المجموعة : ${groupName}`);
        await sendMessage(ownerIdStr, `عذرًا! تم رفض مجموعتك "${groupName}".`);
    }

    await editMessageReplyMarkup(chatId, messageId, {}); // إزالة الأزرار بعد المعالجة
    await ctx.answerCbQuery();
}

async function processSearchGroup(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const searchTerm = ctx.message.text.trim().toLowerCase();
    const allGroups = await getGroups();
    let foundGroups = [];

    await clearInProgress(chatId); // مسح حالة البحث

    if (!searchTerm) {
        await sendMessage(chatId, "الرجاء إدخال اسم للبحث عنه.");
        return;
    }

    for (const ownerId in allGroups) {
        for (const groupName in allGroups[ownerId]) {
            const groupData = allGroups[ownerId][groupName];
            if (groupData.status === "approved" && groupName.toLowerCase().includes(searchTerm)) {
                foundGroups.push(groupData);
            }
        }
    }

    if (foundGroups.length > 0) {
        let message = "نتائج البحث:\n\n";
        foundGroups.forEach(group => {
            message += `- اسم المجموعة: ${group.name}⭐.\n- رابط: ${group.link}\n\n`;
        });
        await sendMessage(chatId, message);
    } else {
        await sendMessage(chatId, "لم يتم العثور على مجموعات مطابقة لاسم البحث.");
    }
}

async function showGroups(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const messageId = ctx.callbackQuery.message.message_id;

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        return ctx.answerCbQuery("- انجب معندك صلاحيات .", true);
    }

    const allGroups = await getGroups();
    let message = "روابط الكروبات :\n\n";
    let foundAny = false;

    for (const ownerId in allGroups) {
        for (const groupName in allGroups[ownerId]) {
            const groupData = allGroups[ownerId][groupName];
            if (groupData.status === "approved") {
                message += `- اسم المجموعة: ${groupName}⭐.\n- رابط: ${groupData.link}\n\n`;
                foundAny = true;
            }
        }
    }

    if (!foundAny) {
        message = "لا توجد كروبات مضافة بعد.";
    }

    const markup = Markup.inlineKeyboard([
        Markup.button.callback('رجوع', 'admin_panel_inline')
    ]).extra();

    await editMessageText(chatId, messageId, message, markup);
    await ctx.answerCbQuery();
}

async function processDeleteGroup(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const groupToDeleteName = ctx.message.text.trim();
    let groupDeleted = false;

    if (userId !== ADMIN_ID_1 && userId !== ADMIN_ID_2) {
        await sendMessage(chatId, "معندك صلاحية لمسح المجموعات.");
        await clearInProgress(chatId);
        return;
    }

    const allGroups = await getGroups();
    for (const ownerId in allGroups) {
        if (allGroups[ownerId][groupToDeleteName]) {
            delete allGroups[ownerId][groupToDeleteName];
            await kv.set('groups', allGroups); // حفظ التغيير
            groupDeleted = true;
            break;
        }
    }

    if (groupDeleted) {
        await sendMessage(chatId, `تم مسح المجموعة "${groupToDeleteName}" بنجاح.`);
    } else {
        await sendMessage(chatId, `لم يتم العثور على المجموعة "${groupToDeleteName}".`);
    }
    await clearInProgress(chatId);
}


// -----------------------------------------------------------
// معالج الـ Webhook
// -----------------------------------------------------------

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res); // Telegraf يعالج الـ update
            res.status(200).send('OK');
        } catch (error) {
            console.error('Error handling update:', error);
            res.status(500).send('Error');
        }
    } else {
        res.status(200).send('This is the Telegram bot webhook endpoint.');
    }
};

