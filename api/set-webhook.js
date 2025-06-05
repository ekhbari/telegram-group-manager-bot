const { Telegraf } = require('telegraf');

// يجب تعيين هذا كمتغير بيئة في Vercel (BOT_TOKEN)
const BOT_TOKEN = process.env.BOT_TOKEN;
// يجب تعيين هذا كمتغير بيئة في Vercel (VERCEL_URL)
// VERCEL_URL هو متغير بيئة تلقائي في Vercel أثناء النشر
// مثال: https://your-project-name.vercel.app
const VERCEL_URL = process.env.VERCEL_URL;

module.exports = async (req, res) => {
    if (!BOT_TOKEN) {
        return res.status(400).send('BOT_TOKEN environment variable is not set.');
    }
    if (!VERCEL_URL) {
        return res.status(400).send('VERCEL_URL environment variable is not set.');
    }

    const webhookUrl = `${VERCEL_URL}/api/webhook`; // عنوان الـ webhook الخاص بك

    try {
        const bot = new Telegraf(BOT_TOKEN);
        // تعيين الـ webhook
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
        res.status(200).send(`Webhook set successfully to ${webhookUrl}`);
    } catch (error) {
        console.error('Error setting webhook:', error);
        res.status(500).send(`Failed to set webhook: ${error.message}`);
    }
};

