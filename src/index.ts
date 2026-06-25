import * as dotenv from 'dotenv';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import { getCurrentlyPlaying, getAuthorizationUrl, handleAuthorizationCode, addTrackToPlaylist } from './spotify';
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

const ROCKY_LINES = {
  welcomeConnected: [
    "Amaze! Friend {name}! You are ready to share music. Yes, yes, yes! ♪ ♫\nWhat do you want to do? Question?",
    "Happy! Friend {name} is here! Music is good, yes? Yes! ♪\nWhat do you want to do? Question?",
    "Friend {name}! We share music, we learn! Good, good, good! ♫\nWhat do you want to do? Question?",
    "Amaze, friend {name}! You connected! Now we listen together, yes? Yes! ♪ ♫\nWhat do you want to do? Question?"
  ],
  welcomeNotConnected: [
    "Welcome Friend {name}! Need Spotify to share music! Authorize below, please? ♪\n\n",
    "Hello Friend {name}! Cannot hear music without Spotify! Click link, click link! ♫\n\n",
    "Friend {name}! Setup Spotify first, yes? Yes! Then we share good sounds! ♪\n\n",
    "Welcome! To share human music, must connect Spotify! You do this now? Question? ♪\n\n"
  ],
  notListening: [
    "Friend {name}, you are not listening to music right now! Bad! ♫",
    "Silence! Friend {name} plays nothing. Why? Question? ♪",
    "No sound! Friend {name} is not playing Spotify. Bad, bad, bad! ♫",
    "You do not listen to music, friend {name}. I am leak! Put some sound, yes? ♪"
  ],
  otherNotListening: [
    "Sad! Friend {name} is not listening to anything right now. ♫",
    "Friend {name} has quiet room. No music! Sad! ♪",
    "No music from friend {name}! They must be sleeping or working, yes? ♪ ♫",
    "Quiet! Friend {name} is not playing Spotify. I wait! ♫"
  ],
  shareSuccess: [
    "Amaze! Friend {name} is listening to:\n{url}\n#music ♪ ♫",
    "Good, good, good! Friend {name} shares sound:\n{url}\n#music ♪",
    "I hear this! Friend {name} plays:\n{url}\n#music ♫",
    "Yes, yes, yes! Listen to friend {name} music:\n{url}\n#music ♪ ♫"
  ],
  vibesSuccess: [
    "🎵 Friend <b>{name}</b> is listening to:\n<b>{track}</b> by <i>{artists}</i>\n\n{url}",
    "🎵 Good vibes! Friend <b>{name}</b> plays:\n<b>{track}</b> by <i>{artists}</i>\n\n{url} ♪",
    "🎵 Listen! Friend <b>{name}</b> is listening:\n<b>{track}</b> by <i>{artists}</i>\n\n{url} ♫",
    "🎵 Beautiful sound! Friend <b>{name}</b> listening to:\n<b>{track}</b> by <i>{artists}</i>\n\n{url} ♪ ♫"
  ],
  sameSong: [
    "\n\n<b>AMAZE! AMAZE! AMAZE!</b>\nYou and {name} are listening to the EXACT SAME SONG! Yes, yes, yes! ♪ ♫",
    "\n\n<b>YES, YES, YES!</b>\nSame song! You and {name} have same brain! Amaze! ♪ ♫",
    "\n\n<b>HEAR THIS!</b>\nYou and friend {name} listen to same thing at same time! Match! Good, good, good! ♪",
    "\n\n<b>AMAZE!</b>\nDual listening! Same sound waves for you and {name}! Yes! ♫"
  ],
  playlistSuccess: [
    "Amaze! Song added to shared playlist! Yes, yes, yes! ♪",
    "Added! Playlist is bigger now! Good, good, good! ♫",
    "Save to memory! Song is in playlist! Yes! ♪",
    "Amaze! I keep this song forever in shared playlist! Yes, yes, yes! ♪ ♫"
  ],
  playlistError: [
    "Error adding track! Do you have playlist-modify permissions? Bad! ♫",
    "Sad! Cannot write to playlist! Bad, bad, bad! ♪",
    "Failure! Playlist reject song. Broken? Question? ♫",
    "Cannot add! Check Spotify rules, friend. Sad! ♪"
  ],
  welcomeAlreadyConnectedLink: [
    "Amaze! Friend {name}! Spotify is already connected! But if you want to connect different account, use link below, please? ♪\n\n",
    "Friend {name}! You have link to Spotify already! Yes! But if link is broken or you want new account, click below! ♫\n\n",
    "Yes, yes, yes! Already connected, friend {name}! Want to re-authenticate or use other Spotify? Use this link: ♪\n\n",
    "Amaze! Connection exists! If you must change accounts or refresh, click the button below, yes? Yes! ♫\n\n"
  ],
  connectionSuccess: [
    "✅ <b>Amaze! Spotify Connected!</b>\nYour Spotify account is now linked! Yes, yes, yes! ♪ ♫\nUse /menu to start sharing!",
    "✅ <b>Happy! Connection successful!</b>\nSpotify is linked to bot! We hear music now! Good, good, good! ♪\nUse /menu to start!",
    "✅ <b>Yes, yes, yes! Spotify connected!</b>\nLinked successfully, friend! Now we can see vibes! ♫\nUse /menu to start!",
    "✅ <b>Amaze! Linked!</b>\nSpotify account is connected! Share sound now! Yes! ♪ ♫\nUse /menu to start!"
  ],
  userNotLinked: [
    "Sad! Friend {name} has not linked Spotify account yet. Bad! They must send /login to bot! ♪",
    "Silence! Friend {name} has no Spotify connection. They must use /login, yes? Yes! ♫",
    "No connection! Friend {name} needs to authorize Spotify. Tell them to send /login, please! ♪ ♫",
    "Cannot check vibes! Friend {name} has not connected Spotify. Sad! They must run /login! ♪"
  ],
  selfNotLinked: [
    "❌ <b>Sad! Spotify not connected.</b>\nFriend, you must link account first! Click /login, please? ♪",
    "❌ <b>No Spotify!</b>\nCannot check music without connection! Run /login to fix, yes? ♫",
    "❌ <b>Failure!</b>\nYour Spotify is not linked to bot! Run /login first! Bad, bad, bad! ♪ ♫",
    "❌ <b>Silence!</b>\nYou have not connected Spotify! Use /login to add connection, please? ♪"
  ]
};

function getRandomLine(type: keyof typeof ROCKY_LINES, replacements: Record<string, string> = {}): string {
  const lines = ROCKY_LINES[type];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return Object.entries(replacements).reduce(
    (acc, [key, val]) => acc.replace(new RegExp(`{${key}}`, 'g'), val),
    line
  );
}

// Middleware: Restrict access to allowed users
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  
  if (!userId || !ALLOWED_USERS[userId]) {
    console.log(`Blocked message from unauthorized user ID: ${userId || 'unknown'}`);
    return; // Silently ignore unauthorized users
  }
  
  return next();
});

// Command: /start or /menu
bot.command(['start', 'menu'], async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  const authUrl = getAuthorizationUrl(userId);

  const existingTokens = await getTokens(userId);
  
  if (existingTokens) {
    const msg = getRandomLine('welcomeConnected', { name: userName });
    await ctx.reply(msg, Markup.inlineKeyboard([
      [Markup.button.callback('🎵 Share My Song', 'action_share')],
      [Markup.button.callback('👀 Check Vibes', 'action_vibes')]
    ]));
  } else {
    const statusMessage = getRandomLine('welcomeNotConnected', { name: userName });
    await ctx.replyWithHTML(
      `${statusMessage}🔌 <a href="${authUrl}"><b>Connect Spotify</b></a>\n\n<i>Note: Make sure to authorize the app. Once completed, this page will redirect you back.</i>`,
      { link_preview_options: { is_disabled: true } }
    );
  }
});

// Command: /login
bot.command('login', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  const authUrl = getAuthorizationUrl(userId);

  const existingTokens = await getTokens(userId);
  
  const statusMessage = existingTokens 
    ? getRandomLine('welcomeAlreadyConnectedLink', { name: userName })
    : getRandomLine('welcomeNotConnected', { name: userName });

  await ctx.replyWithHTML(
    `${statusMessage}🔌 <a href="${authUrl}"><b>Connect Spotify</b></a>\n\n<i>Note: Make sure to authorize the app. Once completed, this page will redirect you back.</i>`,
    { link_preview_options: { is_disabled: true } }
  );
});

// Helper for "Share"
async function handleShare(ctx: any, userId: string, userName: string) {
  try {
    const playback = await getCurrentlyPlaying(userId);

    if (playback === null) {
      const msg = getRandomLine('selfNotLinked');
      return ctx.replyWithHTML(msg);
    }

    if (!playback.isPlaying) {
      const msg = getRandomLine('notListening', { name: userName });
      return ctx.reply(msg);
    }

    // Reply with track URL and interactive button to add to playlist
    const msg = getRandomLine('shareSuccess', { name: userName, url: playback.spotifyUrl });
    
    if (playback.trackUri) {
      await ctx.reply(msg, Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add to Rocky\'s Playlist', `add_pl_${playback.trackUri}`)]
      ]));
    } else {
      await ctx.reply(msg);
    }
  } catch (err) {
    console.error(`Error in share for user ${userName}:`, err);
    await ctx.reply(`⚠️ Sad! Ran into an error fetching Spotify track.`);
  }
}

// Action: Share
bot.action('action_share', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  await handleShare(ctx, userId, userName);
});

// Command: /share
bot.command('share', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  await handleShare(ctx, userId, userName);
});

// Helper for "Vibes"
async function handleVibes(ctx: any, senderId: string, senderName: string) {
  const otherUserId = allowedIds.find((id) => id !== senderId);
  if (!otherUserId) {
    return ctx.reply('Error! No other friend registered to check vibes. Lonely! ♫');
  }

  const otherUserName = ALLOWED_USERS[otherUserId];

  try {
    const playback = await getCurrentlyPlaying(otherUserId);
    const myPlayback = await getCurrentlyPlaying(senderId);

    if (playback === null) {
      const msg = getRandomLine('userNotLinked', { name: otherUserName });
      return ctx.reply(msg);
    }

    if (!playback.isPlaying) {
      const msg = getRandomLine('otherNotListening', { name: otherUserName });
      return ctx.reply(msg);
    }

    // Check if listening to the same song
    let sameSongText = '';
    if (myPlayback?.isPlaying && playback.trackUri && myPlayback.trackUri === playback.trackUri) {
      sameSongText = getRandomLine('sameSong', { name: otherUserName });
    }

    const msg = getRandomLine('vibesSuccess', {
      name: otherUserName,
      track: playback.trackName,
      artists: playback.artists,
      url: playback.spotifyUrl
    }) + sameSongText;

    if (playback.trackUri) {
      await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add to Rocky\'s Playlist', `add_pl_${playback.trackUri}`)]
      ]));
    } else {
      await ctx.replyWithHTML(msg);
    }
  } catch (err) {
    console.error(`Error checking vibes for ${otherUserName}:`, err);
    await ctx.reply(`⚠️ Sad! Could not fetch ${otherUserName}'s Spotify status.`);
  }
}

// Action: Vibes
bot.action('action_vibes', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  await handleVibes(ctx, userId, userName);
});

// Command: /vibes
bot.command('vibes', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];
  await handleVibes(ctx, userId, userName);
});

// Inline Query Handler
bot.on('inline_query', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ALLOWED_USERS[userId];

  console.log(`Received inline query from ${userName || 'unknown user'} (${userId})`);

  try {
    const results: any[] = [];
    
    // 1. Fetch current user's playback (for Share Song)
    const playback = await getCurrentlyPlaying(userId);

    if (playback === null) {
      const msg = getRandomLine('selfNotLinked');
      results.push({
        type: 'article',
        id: 'not_linked',
        title: 'Spotify Not Linked',
        description: 'You need to link your Spotify account to share music.',
        input_message_content: { message_text: msg }
      });
    } else if (!playback.isPlaying) {
      const msg = getRandomLine('notListening', { name: userName });
      results.push({
        type: 'article',
        id: 'not_listening',
        title: 'Not playing anything',
        description: 'You are not listening to music right now.',
        input_message_content: { message_text: msg }
      });
    } else {
      const shareMsg = getRandomLine('shareSuccess', { name: userName, url: playback.spotifyUrl });
      results.push({
        type: 'article',
        id: 'share_song',
        title: `🎵 Share: ${playback.trackName}`,
        description: `by ${playback.artists}`,
        input_message_content: {
          message_text: shareMsg
        },
        reply_markup: playback.trackUri ? Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add to Rocky\'s Playlist', `add_pl_${playback.trackUri}`)]
        ]).reply_markup : undefined
      });
    }

    // 2. Add "Check Vibes" option (Check what the other user is listening to)
    const otherUserId = allowedIds.find((id) => id !== userId);
    if (otherUserId) {
      const otherUserName = ALLOWED_USERS[otherUserId];
      results.push({
        type: 'article',
        id: 'check_vibes',
        title: `👀 Check ${otherUserName}'s Vibes`,
        description: `See what ${otherUserName} is listening to right now`,
        input_message_content: {
          message_text: `Checking vibes for ${otherUserName}... (Sent via inline)`
        },
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`Check ${otherUserName}'s Vibes Now`, 'action_vibes')]
        ]).reply_markup
      });
    }

    await ctx.answerInlineQuery(results, { cache_time: 0 });
  } catch (err) {
    console.error(`Error handling inline query for user ${userName}:`, err);
  }
});

// Action: Add to Playlist
bot.action(/^add_pl_(.+)$/, async (ctx) => {
  const trackUri = ctx.match[1];
  const userId = String(ctx.from.id);

  try {
    if (!process.env.SPOTIFY_PLAYLIST_ID) {
      return ctx.answerCbQuery('Error: SPOTIFY_PLAYLIST_ID is missing from .env! Bad!', { show_alert: true });
    }
    await addTrackToPlaylist(userId, trackUri);
    const alertMsg = getRandomLine('playlistSuccess');
    await ctx.answerCbQuery(alertMsg, { show_alert: false });
  } catch (err: any) {
    console.error('Error adding track to playlist:', err);
    const errMsg = getRandomLine('playlistError');
    await ctx.answerCbQuery(errMsg, { show_alert: true });
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
    const successMsg = getRandomLine('connectionSuccess');
    bot.telegram.sendMessage(
      state,
      successMsg,
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
  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Spotify callback server listening on port ${port} (0.0.0.0)`);
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
