import * as dotenv from 'dotenv';
import express from 'express';
import { Telegraf } from 'telegraf';
import { getCurrentlyPlaying, getAuthorizationUrl, handleAuthorizationCode } from './spotify';
import { getTokens } from './db';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in the environment variables.');
  process.exit(1);
}

// Build allowed users registry
const ALLOWED_USERS: Record<string, string> = {};
if (process.env.USER_1_ID && process.env.USER_1_NAME) {
  ALLOWED_USERS[process.env.USER_1_ID.trim()] = process.env.USER_1_NAME.trim();
}
if (process.env.USER_2_ID && process.env.USER_2_NAME) {
  ALLOWED_USERS[process.env.USER_2_ID.trim()] = process.env.USER_2_NAME.trim();
}

const allowedIds = Object.keys(ALLOWED_USERS);
if (allowedIds.length === 0) {
  console.warn('Warning: No allowed users configured. The bot will ignore all messages.');
} else {
  console.log(`Allowed Users initialized:`, ALLOWED_USERS);
}

// Initialize Telegraf Bot
const bot = new Telegraf(token);

// Middleware: Restrict access to allowed users
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  
  if (!userId || !ALLOWED_USERS[userId]) {
    console.log(`Blocked message from unauthorized user ID: ${userId || 'unknown'}`);
    return; // Silently ignore unauthorized users
  }
  
  return next();
});

// Command: /start or /login
bot.command(['start', 'login'], async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  const authUrl = getAuthorizationUrl(userId);

  const existingTokens = await getTokens(userId);
  let statusMessage = '';
  
  if (existingTokens) {
    statusMessage = `Hello ${userName}! You have already connected Spotify. If you need to re-authenticate or connect a different account, use the link below:\n\n`;
  } else {
    statusMessage = `Welcome ${userName}! To start sharing your Spotify tracks, you need to connect your Spotify account first. Click the button below to authorize:\n\n`;
  }

  await ctx.replyWithHTML(
    `${statusMessage}🔌 <a href="${authUrl}"><b>Connect Spotify</b></a>\n\n<i>Note: Make sure to authorize the app. Once completed, this page will redirect you back.</i>`,
    { link_preview_options: { is_disabled: true } }
  );
});

// Command: /share
bot.command('share', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];

  try {
    const playback = await getCurrentlyPlaying(userId);

    if (playback === null) {
      return ctx.replyWithHTML(
        `❌ <b>Spotify not connected.</b>\nPlease link your account first using /login.`
      );
    }

    if (!playback.isPlaying) {
      return ctx.reply(`Hey ${userName}, you aren't currently playing anything on Spotify!`);
    }

    // Reply with track URL and hashtag
    await ctx.reply(`${playback.spotifyUrl}\n#music`);
  } catch (err) {
    console.error(`Error in /share for user ${userName} (${userId}):`, err);
    await ctx.reply(`⚠️ Sorry, I ran into an error while trying to fetch your currently playing track from Spotify.`);
  }
});

// Command: /vibes
bot.command('vibes', async (ctx) => {
  const senderId = String(ctx.from.id);
  
  // Find the other user ID
  const otherUserId = allowedIds.find((id) => id !== senderId);
  if (!otherUserId) {
    return ctx.reply('Error: No other user registered on this bot to check vibes for.');
  }

  const otherUserName = ALLOWED_USERS[otherUserId];

  try {
    const playback = await getCurrentlyPlaying(otherUserId);

    if (playback === null) {
      return ctx.reply(`${otherUserName} has not linked their Spotify account yet. They can link it by sending /login to the bot.`);
    }

    if (!playback.isPlaying) {
      return ctx.reply(`${otherUserName} is not currently listening to anything on Spotify.`);
    }

    // Formatted response
    const msg = `🎵 <b>${otherUserName}</b> is currently listening to:\n` +
      `<b>${playback.trackName}</b> by <i>${playback.artists}</i>\n\n` +
      `${playback.spotifyUrl}`;

    await ctx.replyWithHTML(msg);
  } catch (err) {
    console.error(`Error in /vibes checking for ${otherUserName} (${otherUserId}):`, err);
    await ctx.reply(`⚠️ Sorry, I couldn't fetch ${otherUserName}'s current Spotify status right now.`);
  }
});

// Initialize Express App
const app = express();
const port = process.env.PORT || 3000;

// OAuth callback endpoint
app.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined; // Telegram User ID

  if (!code || !state) {
    return res.status(400).send('Missing authorization code or state.');
  }

  const telegramName = ALLOWED_USERS[state];
  if (!telegramName) {
    console.warn(`Unauthorized login attempt on web callback for Telegram ID: ${state}`);
    return res.status(403).send('Unauthorized. You are not on the allowed user list for this bot.');
  }

  try {
    await handleAuthorizationCode(state, telegramName, code);
    console.log(`Successfully authenticated Spotify for user ${telegramName} (${state})`);

    // Notify user on Telegram
    bot.telegram.sendMessage(
      state,
      `✅ <b>Spotify Connected!</b>\nYour Spotify account is now linked. You can start sharing music with /share or check each other's status with /vibes.`,
      { parse_mode: 'HTML' }
    ).catch(err => console.error(`Failed to send Telegram confirmation message to ${state}:`, err));

    // Premium HTML Success Page response
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Spotify Connection Successful</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --spotify-green: #1DB954;
            --bg-color: #0c0f12;
            --text-color: #f3f4f6;
            --card-bg: rgba(255, 255, 255, 0.03);
            --card-border: rgba(255, 255, 255, 0.08);
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: 'Outfit', sans-serif;
            background: linear-gradient(135deg, var(--bg-color) 0%, #182229 100%);
            color: var(--text-color);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
          }
          
          /* Glow decorative elements */
          body::before {
            content: '';
            position: absolute;
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, rgba(29, 185, 84, 0.15) 0%, rgba(0,0,0,0) 70%);
            top: -100px;
            right: -100px;
            z-index: 1;
          }
          body::after {
            content: '';
            position: absolute;
            width: 450px;
            height: 450px;
            background: radial-gradient(circle, rgba(29, 185, 84, 0.1) 0%, rgba(0,0,0,0) 70%);
            bottom: -150px;
            left: -150px;
            z-index: 1;
          }

          .container {
            z-index: 10;
            width: 90%;
            max-width: 480px;
            text-align: center;
            padding: 2.5rem;
            border-radius: 24px;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            animation: fadeIn 0.8s ease-out;
          }

          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .icon-container {
            position: relative;
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .circle-glow {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: var(--spotify-green);
            opacity: 0.2;
            animation: pulse 2s infinite alternate;
          }

          @keyframes pulse {
            0% { transform: scale(0.9); opacity: 0.15; }
            100% { transform: scale(1.15); opacity: 0.3; }
          }

          .checkmark-svg {
            position: relative;
            z-index: 2;
            width: 50px;
            height: 50px;
            fill: none;
            stroke: var(--spotify-green);
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
            stroke-dasharray: 100;
            stroke-dashoffset: 100;
            animation: drawCheck 0.8s 0.2s ease-in-out forwards;
          }

          @keyframes drawCheck {
            to { stroke-dashoffset: 0; }
          }

          h1 {
            font-size: 1.8rem;
            font-weight: 800;
            margin-bottom: 0.75rem;
            letter-spacing: -0.5px;
            background: linear-gradient(90deg, #ffffff 0%, #a3a9b3 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }

          p {
            font-size: 1rem;
            line-height: 1.6;
            color: #9ca3af;
            margin-bottom: 2rem;
            font-weight: 300;
          }

          .badge {
            display: inline-block;
            padding: 6px 16px;
            background: rgba(29, 185, 84, 0.15);
            color: var(--spotify-green);
            border-radius: 50px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            border: 1px solid rgba(29, 185, 84, 0.25);
          }

          .instructions {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 1rem;
            font-size: 0.9rem;
            color: #6b7280;
          }

          .instructions strong {
            color: #d1d5db;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon-container">
            <div class="circle-glow"></div>
            <svg class="checkmark-svg" viewBox="0 0 24 24">
              <path d="M20 6L9 17L4 12" />
            </svg>
          </div>
          <span class="badge">Connected as ${telegramName}</span>
          <h1>Success!</h1>
          <p>Your Spotify account is now linked securely with your private Telegram bot.</p>
          <div class="instructions">
            You can close this page and return to Telegram. Try using <strong>/share</strong> in your chat!
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error exchanging code during Spotify authorization callback:', err);
    res.status(500).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 3rem; background: #0c0f12; color: #f3f4f6; min-height: 100vh; display: flex; flex-direction: column; justify-content: center;">
        <h1 style="color: #ef4444; margin-bottom: 1rem;">Authentication Failed</h1>
        <p style="color: #9ca3af; margin-bottom: 2rem;">Could not exchange Spotify token. Check your server logs.</p>
        <p style="font-size: 0.9rem; color: #4b5563;">Error details: ${err instanceof Error ? err.message : String(err)}</p>
      </div>
    `);
  }
});

// Start Express and Telegram Bot
async function main() {
  // Start OAuth callback server
  app.listen(port, () => {
    console.log(`Spotify callback server listening on port ${port}`);
  });

  // Launch Telegram Bot (Long-Polling mode)
  bot.launch()
    .then(() => {
      console.log('Telegram Bot started successfully (Long-Polling mode).');
    })
    .catch((err) => {
      console.error('Failed to start Telegram Bot:', err);
    });

  // Enable graceful stop
  process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Application failed to start:', err);
});
