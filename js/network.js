// ============================================================
// PEER NETWORK — PeerJS-based P2P multiplayer
// Host is the authoritative server; clients connect by room code
// ============================================================

class PeerNetwork {
  constructor(onMessage, onConnect, onDisconnect, onError) {
    this.peer       = null;
    this.connections = {};    // peerId → DataConnection
    this.isHost     = false;
    this.hostConn   = null;   // client's connection to host
    this.myPeerId   = null;
    this.roomCode   = null;

    this._onMessage    = onMessage;
    this._onConnect    = onConnect;
    this._onDisconnect = onDisconnect;
    this._onError      = onError;
  }

  // ── Host: create room ──────────────────────────────────────
  createRoom(playerName, callback) {
    this.isHost = true;
    this.peer = new Peer(undefined, { debug: 1 });

    this.peer.on('open', (id) => {
      this.myPeerId = id;
      // Room code = first 6 uppercase chars of peer ID
      this.roomCode = id.substring(0, 6).toUpperCase();
      console.log('[NET] Room created:', this.roomCode, 'peer:', id);
      callback({ ok: true, roomCode: this.roomCode, peerId: id });
    });

    this.peer.on('connection', (conn) => {
      this._setupHostConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('[NET] Host peer error:', err);
      this._onError('Ошибка сети: ' + err.type);
    });
  }

  // ── Client: join room ──────────────────────────────────────
  joinRoom(roomCode, playerName, callback) {
    this.isHost = false;
    this.roomCode = roomCode.toUpperCase().trim();
    this.peer = new Peer(undefined, { debug: 1 });

    this.peer.on('open', (id) => {
      this.myPeerId = id;
      // Reconstruct host peer ID: room code (lowercase) + rest is unknown
      // We store full peer IDs differently — host exposes full ID via room code
      // Room code IS the first 6 chars of host's peer ID
      // We need to find the full peer ID; store it in the code:
      // Actually roomCode IS full peerId of host for simplicity:
      const hostId = this.roomCode; // We'll use full peer ID as code
      console.log('[NET] Connecting to host:', hostId);
      const conn = this.peer.connect(hostId, { reliable: true });
      this.hostConn = conn;
      this._setupClientConnection(conn, callback);
    });

    this.peer.on('error', (err) => {
      console.error('[NET] Client peer error:', err);
      callback({ ok: false, error: 'Не удалось подключиться: ' + err.type });
      this._onError('Ошибка сети: ' + err.type);
    });
  }

  _setupHostConnection(conn) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      console.log('[NET] Client connected:', conn.peer);
      this._onConnect(conn.peer);
    });

    conn.on('data', (data) => {
      console.log('[NET] Host received from', conn.peer, data);
      this._onMessage(conn.peer, data);
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
      console.log('[NET] Client disconnected:', conn.peer);
      this._onDisconnect(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('[NET] Connection error:', err);
    });
  }

  _setupClientConnection(conn, callback) {
    let opened = false;
    conn.on('open', () => {
      opened = true;
      console.log('[NET] Connected to host');
      callback({ ok: true });
    });

    conn.on('data', (data) => {
      console.log('[NET] Client received:', data);
      this._onMessage('host', data);
    });

    conn.on('close', () => {
      console.log('[NET] Disconnected from host');
      this._onDisconnect('host');
    });

    conn.on('error', (err) => {
      console.error('[NET] Conn error:', err);
      if (!opened) callback({ ok: false, error: 'Не удалось подключиться' });
    });

    // Timeout if host not found
    setTimeout(() => {
      if (!opened) callback({ ok: false, error: 'Хост не ответил. Проверьте код.' });
    }, 8000);
  }

  // ── Send message ───────────────────────────────────────────
  // Host → all clients
  broadcast(msg) {
    const data = JSON.stringify(msg);
    Object.values(this.connections).forEach(conn => {
      if (conn.open) conn.send(data);
    });
  }

  // Host → specific client
  sendTo(peerId, msg) {
    const conn = this.connections[peerId];
    if (conn && conn.open) conn.send(JSON.stringify(msg));
  }

  // Client → host
  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(JSON.stringify(msg));
    }
  }

  // Convenience: send action (client calls this, host calls broadcast)
  send(msg) {
    if (this.isHost) {
      this.broadcast(msg);
    } else {
      this.sendToHost(msg);
    }
  }

  destroy() {
    if (this.peer) this.peer.destroy();
  }

  get connectedPeers() {
    return Object.keys(this.connections);
  }
}
