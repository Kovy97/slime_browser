/**
 * Slime Browser - Email Client Module
 * IMAP (read) + SMTP (send) + IDLE (push notifications)
 */

const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { Notification } = require('electron');
const crypto = require('crypto');
const path = require('path');

// Active IMAP connections (reused across requests)
const connections = new Map();
const idleWatchers = new Map();

async function getOrConnect(accountId, decrypt, readJSON) {
  if (connections.has(accountId)) {
    const client = connections.get(accountId);
    if (client.usable) return client;
    connections.delete(accountId);
  }

  const accounts = readJSON('email-accounts.json', []);
  const account = accounts.find(a => a.id === accountId);
  if (!account) throw new Error('Account not found');

  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.port === 993,
    auth: { user: account.username, pass: decrypt(account.password) },
    logger: false,
  });

  await client.connect();
  connections.set(accountId, client);

  client.on('close', () => {
    connections.delete(accountId);
  });

  client.on('error', (err) => {
    console.log('[Slime Email] IMAP connection error for', accountId, ':', err.message);
    connections.delete(accountId);
  });

  return client;
}

function setupEmail(ipcMain, encrypt, decrypt, readJSON, writeJSON, dataPath, getMainWindow) {

  // ==========================================
  // Account CRUD
  // ==========================================

  ipcMain.handle('email-accounts-get', () => {
    const accounts = readJSON('email-accounts.json', []);
    return accounts.map(a => ({ ...a, password: decrypt(a.password) }));
  });

  ipcMain.handle('email-accounts-save', (_, account) => {
    if (!account || typeof account !== 'object') return null;
    const accounts = readJSON('email-accounts.json', []);
    const encrypted = {
      ...account,
      password: encrypt(account.password),
    };
    if (!encrypted.id) encrypted.id = crypto.randomUUID();

    const idx = accounts.findIndex(a => a.id === encrypted.id);
    if (idx >= 0) {
      accounts[idx] = { ...encrypted, updatedAt: Date.now() };
    } else {
      accounts.push({ ...encrypted, createdAt: Date.now() });
    }
    writeJSON('email-accounts.json', accounts);
    return encrypted.id;
  });

  ipcMain.handle('email-accounts-remove', (_, id) => {
    // Disconnect if connected
    const client = connections.get(id);
    if (client) {
      client.logout().catch(() => {});
      connections.delete(id);
    }
    stopIdleWatcher(id);
    const accounts = readJSON('email-accounts.json', []).filter(a => a.id !== id);
    writeJSON('email-accounts.json', accounts);
    return accounts;
  });

  ipcMain.handle('email-accounts-test', async (_, account) => {
    console.log('[Slime Email] Testing connection for', account.username, '(pass length:', account.password?.length, ') | IMAP:', account.imap?.host + ':' + account.imap?.port, '| SMTP:', account.smtp?.host + ':' + account.smtp?.port);
    // Test IMAP
    try {
      const client = new ImapFlow({
        host: account.imap.host,
        port: account.imap.port,
        secure: account.imap.port === 993,
        auth: { user: account.username, pass: account.password },
        logger: {
          debug: (obj) => console.log('[IMAP debug]', obj?.msg || JSON.stringify(obj)),
          info: (obj) => console.log('[IMAP info]', obj?.msg || JSON.stringify(obj)),
          warn: (obj) => console.log('[IMAP warn]', obj?.msg || JSON.stringify(obj)),
          error: (obj) => console.log('[IMAP error]', obj?.msg || JSON.stringify(obj)),
        },
        tls: { rejectUnauthorized: false },
      });
      await client.connect();
      await client.logout();
      console.log('[Slime Email] IMAP OK');
    } catch (e) {
      console.log('[Slime Email] IMAP failed:', e.message, '| responseText:', e.responseText, '| code:', e.code);
      const detail = e.responseText ? (' — Server: ' + e.responseText) : '';
      return { success: false, error: 'IMAP: ' + e.message + detail };
    }
    // Test SMTP
    try {
      const transport = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.port === 465,
        auth: { user: account.username, pass: account.password },
      });
      await transport.verify();
      transport.close();
      console.log('[Slime Email] SMTP OK');
    } catch (e) {
      console.log('[Slime Email] SMTP failed:', e.message);
      return { success: false, error: 'SMTP: ' + e.message };
    }
    return { success: true };
  });

  // ==========================================
  // Folders
  // ==========================================

  ipcMain.handle('email-folders-get', async (_, accountId) => {
    const client = await getOrConnect(accountId, decrypt, readJSON);
    const list = await client.list();
    return list.map(mb => ({ name: mb.name, path: mb.path, specialUse: mb.specialUse }));
  });

  // ==========================================
  // Messages
  // ==========================================

  ipcMain.handle('email-messages-get', async (_, accountId, folder, page = 0) => {
    const client = await getOrConnect(accountId, decrypt, readJSON);
    const lock = await client.getMailboxLock(folder);
    try {
      const messages = [];
      const limit = 50;
      const total = client.mailbox.exists;
      if (total === 0) return { messages: [], total: 0, hasMore: false };

      const end = total - page * limit;
      const start = Math.max(1, end - limit + 1);
      if (end < 1) return { messages: [], total, hasMore: false };

      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        uid: true,
        bodyStructure: true,
      })) {
        messages.push({
          uid: msg.uid,
          subject: msg.envelope.subject || '(No Subject)',
          from: msg.envelope.from?.[0] || null,
          date: msg.envelope.date,
          flags: [...msg.flags],
          seen: msg.flags.has('\\Seen'),
        });
      }
      return { messages: messages.reverse(), total, hasMore: start > 1 };
    } finally {
      lock.release();
    }
  });

  ipcMain.handle('email-message-get', async (_, accountId, folder, uid) => {
    const client = await getOrConnect(accountId, decrypt, readJSON);
    const lock = await client.getMailboxLock(folder);
    try {
      const downloaded = await client.download(uid.toString(), undefined, { uid: true });
      const parsed = await simpleParser(downloaded.content);

      // Mark as read
      await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });

      return {
        uid,
        subject: parsed.subject || '(No Subject)',
        from: parsed.from?.text || '',
        to: parsed.to?.text || '',
        date: parsed.date,
        html: parsed.html || null,
        text: parsed.text || null,
      };
    } finally {
      lock.release();
    }
  });

  ipcMain.handle('email-message-delete', async (_, accountId, folder, uid) => {
    const client = await getOrConnect(accountId, decrypt, readJSON);
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete(uid.toString(), { uid: true });
    } finally {
      lock.release();
    }
    return true;
  });

  // ==========================================
  // Send
  // ==========================================

  ipcMain.handle('email-send', async (_, accountId, mail) => {
    const accounts = readJSON('email-accounts.json', []);
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    const transport = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.port === 465,
      auth: { user: account.username, pass: decrypt(account.password) },
    });

    try {
      await transport.sendMail({
        from: account.email,
        to: mail.to,
        subject: mail.subject,
        text: mail.text || mail.body || '',
        html: mail.html || undefined,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      transport.close();
    }
  });

  // ==========================================
  // Push Notifications (IMAP IDLE)
  // ==========================================

  ipcMain.handle('email-notifications-set', async (_, accountId, enabled) => {
    const accounts = readJSON('email-accounts.json', []);
    const idx = accounts.findIndex(a => a.id === accountId);
    if (idx >= 0) {
      accounts[idx].notifications = enabled;
      writeJSON('email-accounts.json', accounts);
    }
    if (enabled) {
      startIdleWatcher(accountId, decrypt, readJSON, getMainWindow);
    } else {
      stopIdleWatcher(accountId);
    }
    return true;
  });

  // Auto-start IDLE for accounts with notifications enabled
  setTimeout(() => {
    const accounts = readJSON('email-accounts.json', []);
    for (const account of accounts) {
      if (account.notifications) {
        startIdleWatcher(account.id, decrypt, readJSON, getMainWindow);
      }
    }
  }, 5000);
}

async function startIdleWatcher(accountId, decrypt, readJSON, getMainWindow) {
  if (idleWatchers.has(accountId)) return;

  try {
    const client = await getOrConnect(accountId, decrypt, readJSON);
    const lock = await client.getMailboxLock('INBOX');

    client.on('exists', (data) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('email-new-message', { accountId });
      }
      const notif = new Notification({
        title: 'Neue E-Mail',
        body: 'Du hast eine neue Nachricht',
        icon: path.join(__dirname, '..', '..', 'Slime1.ico'),
      });
      notif.show();
      notif.on('click', () => {
        const w = getMainWindow();
        if (w) { w.show(); w.focus(); }
      });
    });

    idleWatchers.set(accountId, { lock, client });
  } catch (e) {
    console.log('[Slime Email] IDLE watcher failed for', accountId, e.message);
  }
}

function stopIdleWatcher(accountId) {
  const watcher = idleWatchers.get(accountId);
  if (watcher) {
    try { watcher.lock.release(); } catch (e) {}
    idleWatchers.delete(accountId);
  }
}

module.exports = { setupEmail };
