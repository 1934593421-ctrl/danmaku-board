// 弹幕画板 · 多人房间中继服务（零外部依赖，仅用 ws）
// 房间 / 房主 / 模式(公开聊天·KTV) / 弹幕广播 / 在线人数
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');

const server = http.createServer((req, res) => {
  // 简单静态托管：访问 http://localhost:8787 直接打开弹幕画板
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
             : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server });
// rooms: name -> { clients:Set<ws>, owner:ws|null, mode:'public'|'ktv' }
const rooms = {};

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) {
  for (const c of room.clients) if (c !== except) send(c, obj);
}
function presence(room) { broadcast(room, { type: 'presence', online: room.clients.size }); }

wss.on('connection', ws => {
  ws.room = null; ws.isOwner = false; ws.name = '游客';

  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch (_) { return; }
    if (d.type === 'join') {
      const name = (d.room || 'room-1024').toString().slice(0, 40);
      if (!rooms[name]) rooms[name] = { clients: new Set(), owner: null, mode: 'public' };
      const room = rooms[name];
      room.clients.add(ws); ws.room = name; ws.name = (d.name || '游客').toString().slice(0, 16);
      if (!room.owner) { room.owner = ws; ws.isOwner = true; }
      send(ws, { type: 'welcome', youAreOwner: ws.isOwner, online: room.clients.size, mode: room.mode });
      presence(room);
    } else if (ws.room) {
      const room = rooms[ws.room];
      if (d.type === 'setMode' && ws.isOwner && (d.mode === 'public' || d.mode === 'ktv')) {
        room.mode = d.mode; broadcast(room, { type: 'mode', mode: room.mode });
      } else if (d.type === 'danmaku') {
        // KTV 模式下，歌词(isLyric)只允许房主发，其他人只能聊天
        if (d.payload && d.payload.isLyric && !ws.isOwner) return;
        broadcast(room, { type: 'danmaku', payload: d.payload, from: ws.name }, ws);
      }
    }
  });

  ws.on('close', () => {
    if (!ws.room || !rooms[ws.room]) return;
    const room = rooms[ws.room];
    room.clients.delete(ws);
    if (room.owner === ws) {
      room.owner = room.clients.values().next().value || null;
      if (room.owner) send(room.owner, { type: 'welcome', youAreOwner: true, online: room.clients.size, mode: room.mode });
    }
    presence(room);
    if (room.clients.size === 0) delete rooms[ws.room];
  });
});

server.listen(PORT, () => {
  console.log('弹幕画板中继已启动 → http://localhost:' + PORT);
  console.log('WebSocket: ws://localhost:' + PORT);
});
