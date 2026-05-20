const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const APP_URL = process.env.APP_URL || '';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'states.json');
const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
const DEFAULT_STATE = {
  theme: 'light',
  lang: 'ru',
  tab: 'tasks',
  date: '',
  tasks: {},
  goals: [],
  notes: [],
  archive: { tasks: [], goals: [], notes: [] },
  goalLastAutoDate: ''
};

let pollOffset = 0;

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, JSON.stringify({}, null, 2));
  }
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, statusCode, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readStates() {
  const raw = await fsp.readFile(STATE_PATH, 'utf8');
  return JSON.parse(raw || '{}');
}

async function writeStates(states) {
  await fsp.writeFile(STATE_PATH, JSON.stringify(states, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cloneDefaultState() {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.date = todayKey();
  return state;
}

function normalizeState(state) {
  const base = cloneDefaultState();
  if (!state || typeof state !== 'object') return base;
  return {
    ...base,
    ...state,
    theme: state.theme === 'dark' ? 'dark' : 'light',
    lang: ['ru', 'en', 'ua'].includes(state.lang) ? state.lang : 'ru',
    tab: ['tasks', 'goals', 'notes', 'archive', 'hotkeys'].includes(state.tab) ? state.tab : 'tasks',
    date: typeof state.date === 'string' && state.date ? state.date : base.date,
    tasks: state.tasks && typeof state.tasks === 'object' ? state.tasks : {},
    goals: Array.isArray(state.goals) ? state.goals : [],
    notes: Array.isArray(state.notes) ? state.notes : [],
    archive: {
      tasks: Array.isArray(state.archive?.tasks) ? state.archive.tasks : [],
      goals: Array.isArray(state.archive?.goals) ? state.archive.goals : [],
      notes: Array.isArray(state.archive?.notes) ? state.archive.notes : []
    },
    goalLastAutoDate: typeof state.goalLastAutoDate === 'string' ? state.goalLastAutoDate : ''
  };
}

function verifyInitData(initDataRaw) {
  if (!BOT_TOKEN || !initDataRaw) return null;

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (signature !== hash) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (authDate && (Date.now() / 1000) - authDate > 60 * 60 * 24) {
    return null;
  }

  const userRaw = params.get('user');
  let user = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      user = null;
    }
  }

  if (!user || typeof user.id === 'undefined') return null;
  return { user, authDate };
}

async function getUserState(userId) {
  const states = await readStates();
  return normalizeState(states[String(userId)]);
}

async function saveUserState(userId, state) {
  const states = await readStates();
  states[String(userId)] = normalizeState(state);
  await writeStates(states);
  return states[String(userId)];
}

async function telegramApi(method, payload = {}) {
  if (!TELEGRAM_API) throw new Error('BOT_TOKEN is missing');
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method} failed: ${json.description || response.status}`);
  }
  return json.result;
}

function createLaunchKeyboard() {
  return {
    inline_keyboard: [[
      {
        text: 'Open FocusFlow',
        web_app: { url: APP_URL }
      }
    ]]
  };
}

async function configureBot() {
  if (!BOT_TOKEN || !APP_URL) return;

  if (!APP_URL.startsWith('https://')) {
    console.warn('APP_URL should use HTTPS for Telegram Mini Apps.');
  }

  try {
    await telegramApi('setMyCommands', {
      commands: [
        { command: 'start', description: 'Open FocusFlow' },
        { command: 'app', description: 'Open the mini app' },
        { command: 'help', description: 'Show help' }
      ]
    });

    await telegramApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Open FocusFlow',
        web_app: { url: APP_URL }
      }
    });

    console.log('Bot commands and menu button configured.');
  } catch (error) {
    console.warn('Bot configuration skipped:', error.message);
  }
}

async function handleTelegramUpdate(update) {
  const message = update.message;
  if (!message) return;

  if (message.text === '/start' || message.text === '/app') {
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Open FocusFlow below. Your data will sync to your Telegram account.',
      reply_markup: createLaunchKeyboard()
    });
    return;
  }

  if (message.text === '/help') {
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Use /start to open the FocusFlow Mini App.'
    });
    return;
  }

  if (message.web_app_data?.data) {
    await telegramApi('sendMessage', {
      chat_id: message.chat.id,
      text: 'Data received from Mini App.'
    });
  }
}

async function pollTelegram() {
  if (!BOT_TOKEN) {
    console.warn('BOT_TOKEN is missing, Telegram polling is disabled.');
    return;
  }

  while (true) {
    try {
      const updates = await telegramApi('getUpdates', {
        timeout: 50,
        offset: pollOffset,
        allowed_updates: ['message']
      });

      for (const update of updates) {
        pollOffset = update.update_id + 1;
        await handleTelegramUpdate(update);
      }
    } catch (error) {
      console.warn('Polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = safePath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    textResponse(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(normalized);
    if (stat.isDirectory()) {
      return serveStatic(req, res, path.join(pathname, 'index.html'));
    }
    const contents = await fsp.readFile(normalized);
    res.writeHead(200, { 'Content-Type': getContentType(normalized) });
    res.end(contents);
  } catch {
    textResponse(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return jsonResponse(res, 200, {
      ok: true,
      telegramBotConfigured: Boolean(BOT_TOKEN),
      appUrlConfigured: Boolean(APP_URL)
    });
  }

  if (url.pathname === '/api/state') {
    const auth = verifyInitData(req.headers['x-telegram-init-data']);
    if (!auth) return jsonResponse(res, 401, { ok: false, error: 'Invalid Telegram init data' });

    if (req.method === 'GET') {
      const state = await getUserState(auth.user.id);
      return jsonResponse(res, 200, { ok: true, state, user: auth.user });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const state = await saveUserState(auth.user.id, body.state);
      return jsonResponse(res, 200, { ok: true, state });
    }

    return jsonResponse(res, 405, { ok: false, error: 'Method not allowed' });
  }

  return serveStatic(req, res, url.pathname);
});

async function main() {
  ensureDataFiles();
  await configureBot();

  server.listen(PORT, () => {
    console.log(`FocusFlow Mini App server running on http://localhost:${PORT}`);
  });

  pollTelegram().catch(error => {
    console.error('Telegram polling stopped:', error);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
