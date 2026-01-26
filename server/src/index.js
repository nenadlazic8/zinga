import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { computeTeamScore, createDeck, shuffleInPlace, teamForSeat } from "./game.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

app.get("/health", (_req, res) => res.json({ ok: true, name: "zinga-server" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true }
});

/**
 * In-memory rooms. (Basic engine; persistence not implemented.)
 * Room starts when 4 connected players join.
 */
const rooms = new Map(); // roomId -> room
const matchHistory = new Map(); // roomId -> Array<{date, players, aScore, bScore, winner}>

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      phase: "lobby", // lobby | playing | finished | aborted
      players: [], // {id, name, seat, socketId, connected}
      game: null,
      match: {
        target: 101,
        totals: { A: 0, B: 0 },
        hand: 0,
        startSeat: 0,
        lastHand: null,
        winner: null,
        actionSeq: 0
      },
      rematchReady: new Set() // playerIds who clicked "Revans"
    });
  }
  return rooms.get(roomId);
}

function nextActionId(room) {
  if (!room.match) return Date.now();
  room.match.actionSeq += 1;
  return room.match.actionSeq;
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function playerBySeat(room, seat) {
  return room.players.find((p) => p.seat === seat) || null;
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function dealFourEach(room) {
  const g = room.game;
  const startSeat = g.dealSeat ?? 0;
  for (let offset = 0; offset < 4; offset++) {
    const seat = (startSeat + offset) % 4;
    const p = playerBySeat(room, seat);
    if (!p) continue;
    g.hands[p.id] ||= [];
    for (let i = 0; i < 4; i++) {
      const c = g.deck.pop();
      if (!c) break;
      g.hands[p.id].push(c);
    }
  }
}

function startGame(room, startSeat = room.match?.startSeat ?? 0) {
  const deck = shuffleInPlace(createDeck());
  const hands = {};
  for (const p of room.players) hands[p.id] = [];

  if (room.match) {
    room.match.hand += 1;
    room.match.winner = null;
  }

  room.phase = "playing";
  room.game = {
    round: 1,
    deck,
    table: [],
    hands,
    turnSeat: startSeat,
    dealSeat: startSeat,
    deckOwnerSeat: (startSeat + 3) % 4,
    lastTakerPlayerId: null,
    lastAction: null,
    lastDeal: { id: 0, isLast: false, round: 1, hand: room.match?.hand ?? null },
    captures: {
      A: { cards: [], zinga10: 0, zinga20: 0, bonusMostCards: 0 },
      B: { cards: [], zinga10: 0, zinga20: 0, bonusMostCards: 0 }
    },
    log: [
      room.match
        ? `Ruka ${room.match.hand}. Deljenje: 4 karte + 4 na sto. (Ukupno: ${room.match.totals.A} - ${room.match.totals.B} / ${room.match.target})`
        : "Igra je počela. Deljenje: 4 karte + 4 na sto."
    ]
  };

  dealFourEach(room);
  for (let i = 0; i < 4; i++) {
    const c = room.game.deck.pop();
    if (!c) break;
    room.game.table.push(c);
  }
  // Initial deal event for UI animations
  room.game.lastDeal = { id: nextActionId(room), isLast: false, round: 1, hand: room.match?.hand ?? null };
}

function endGame(room) {
  const g = room.game;
  if (!g) return;

  // Last take: last player who took gets all remaining table cards
  if (g.table.length > 0 && g.lastTakerPlayerId) {
    const lp = findPlayer(room, g.lastTakerPlayerId);
    if (lp) {
      const team = teamForSeat(lp.seat);
      g.captures[team].cards.push(...g.table);
      g.table = [];
    }
  }

  // +4 points for most cards (27+)
  const aCards = g.captures.A.cards.length;
  const bCards = g.captures.B.cards.length;
  if (aCards !== bCards) {
    const winner = aCards > bCards ? "A" : "B";
    if (Math.max(aCards, bCards) >= 27) {
      g.captures[winner].bonusMostCards = 4;
    }
  }

  const aHand = computeTeamScore(g.captures.A);
  const bHand = computeTeamScore(g.captures.B);

  if (room.match) {
    room.match.lastHand = { A: aHand, B: bHand };
    room.match.totals.A += aHand.total;
    room.match.totals.B += bHand.total;

    const aTotal = room.match.totals.A;
    const bTotal = room.match.totals.B;
    const target = room.match.target;

    let winner = null;
    if (aTotal >= target || bTotal >= target) {
      if (aTotal > bTotal) winner = "A";
      else if (bTotal > aTotal) winner = "B";
    }

    if (winner) {
      room.match.winner = winner;
      room.phase = "finished";
      g.log.push(`Kraj ruke. Tim A +${aHand.total}, Tim B +${bHand.total}.`);
      g.log.push(`Pobeda: Tim ${winner} (${aTotal} - ${bTotal})`);

      // Save match result to history
      const playerNames = room.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => p.name);
      const historyKey = `${room.id}:${playerNames.join("|")}`;
      if (!matchHistory.has(historyKey)) {
        matchHistory.set(historyKey, []);
      }
      matchHistory.get(historyKey).push({
        date: Date.now(),
        players: playerNames,
        aScore: aTotal,
        bScore: bTotal,
        winner
      });

      // Send history to all players in room
      const history = matchHistory.get(historyKey) || [];
      for (const p of room.players) {
        io.to(p.socketId).emit("history", history);
      }

      return;
    }

    // Next hand (rotate starting seat)
    room.match.startSeat = nextSeat(room.match.startSeat);
    startGame(room, room.match.startSeat);
    room.game.log.unshift(`Kraj ruke. Tim A +${aHand.total}, Tim B +${bHand.total}.`);
    return;
  }

  room.phase = "finished";
  g.log.push("Kraj igre.");
}

function allHandsEmpty(room) {
  const g = room.game;
  if (!g) return true;
  for (const p of room.players) {
    const h = g.hands[p.id] || [];
    if (h.length > 0) return false;
  }
  return true;
}

function applyPlay(room, playerId, cardId) {
  const g = room.game;
  if (!g) throw new Error("Igra nije pokrenuta.");
  if (room.phase !== "playing") throw new Error("Igra nije u toku.");

  const player = findPlayer(room, playerId);
  if (!player) throw new Error("Igrač nije pronađen.");
  if (player.seat !== g.turnSeat) throw new Error("Nije vaš potez.");

  const hand = g.hands[playerId] || [];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error("Karta nije u vašoj ruci.");

  const [played] = hand.splice(idx, 1);

  const tableBefore = g.table.slice();
  const tableBeforeLen = tableBefore.length;

  let took = false;
  let taken = [];
  let zingaFx = null; // 10 | 20 | null
  let actionType = "drop"; // drop | take | jack_take

  if (played.rank === "J") {
    // Jack (Žandar): takes all cards currently on the table
    if (g.table.length > 0) {
      took = true;
      actionType = "jack_take";
      taken = [...g.table, played];
      g.table = [];
      g.log.push(`${player.name} igra Žandara i uzima ceo sto.`);

      // Zinga na Žandara: ONLY when the single talon card is also a Jack (J on J)
      if (tableBeforeLen === 1 && tableBefore[0]?.rank === "J") {
        const team = teamForSeat(player.seat);
        g.captures[team].zinga20 += 1;
        zingaFx = 20;
        g.log.push(`${player.name} pravi Zingu na Žandara! (+20)`);
      }
    } else {
      g.table.push(played);
      g.log.push(`${player.name} igra Žandara (sto je prazan).`);
    }
  } else {
    // Basic engine: you can take ONLY if your card matches the last (top) card on the talon
    const top = g.table.length ? g.table[g.table.length - 1] : null;
    const isMatchTop = Boolean(top && top.rank === played.rank);
    if (isMatchTop) {
      took = true;
      actionType = "take";
      // On match: team takes the whole talon (entire table) + played card
      taken = [...g.table, played];
      g.table = [];

      // Zinga (Šiba): table had exactly 1 card and it's taken by matching the last card
      if (tableBeforeLen === 1) {
        const team = teamForSeat(player.seat);
        g.captures[team].zinga10 += 1;
        zingaFx = 10;
        g.log.push(`${player.name} pravi Zingu! (+10)`);
      } else {
        g.log.push(`${player.name} uzima ceo talon (poklapanje sa poslednjom: ${played.rank}).`);
      }
    } else {
      g.table.push(played);
      g.log.push(`${player.name} baca ${played.label}.`);
    }
  }

  if (took) {
    const team = teamForSeat(player.seat);
    g.captures[team].cards.push(...taken);
    g.lastTakerPlayerId = playerId;
  }

  // Emit last action for client animations/FX
  g.lastAction = {
    id: nextActionId(room),
    type: actionType,
    fromSeat: player.seat,
    playerName: player.name,
    card: played,
    zinga: zingaFx
  };

  // Advance turn
  g.turnSeat = nextSeat(g.turnSeat);

  // Deal next round if needed
  if (allHandsEmpty(room)) {
    if (g.deck.length > 0) {
      const before = g.deck.length;
      g.round += 1;
      dealFourEach(room);
      g.log.push("Deljenje: po 4 karte.");
      // Deal event for UI animations (and last deal marker)
      const isLast = before > 0 && g.deck.length === 0;
      g.lastDeal = { id: nextActionId(room), isLast, round: g.round, hand: room.match?.hand ?? null };
    } else {
      endGame(room);
    }
  }
}

function sanitizeStateFor(room, viewerPlayerId) {
  const g = room.game;

  const viewer = findPlayer(room, viewerPlayerId);
  const viewerTeam = viewer ? teamForSeat(viewer.seat) : null;

  const players = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      team: teamForSeat(p.seat),
      connected: p.connected,
      drink: p.drink || null,
      glass: Boolean(p.glass),
      cigarette: Boolean(p.cigarette)
    }));

  // Get history for this room + player combination
  const playerNames = players.map((p) => p.name);
  const historyKey = `${room.id}:${playerNames.join("|")}`;
  const history = matchHistory.get(historyKey) || [];

  if (!g) {
    return {
      roomId: room.id,
      phase: room.phase,
      players,
      match: room.match
        ? { target: room.match.target, totals: room.match.totals, hand: room.match.hand, winner: room.match.winner, lastHand: room.match.lastHand, rematchReadyCount: room.rematchReady?.size ?? 0 }
        : null,
      matchHistory: history,
      game: null
    };
  }

  const hands = {};
  for (const p of room.players) {
    const cards = g.hands[p.id] || [];
    hands[p.id] = {
      count: cards.length,
      cards: p.id === viewerPlayerId ? cards : undefined
    };
  }

  const aScore = computeTeamScore(g.captures.A);
  const bScore = computeTeamScore(g.captures.B);
  const tableTop = g.table.length ? g.table[g.table.length - 1] : null;
  const tableCount = g.table.length;
  const deckPeekCard = g.deck.length ? g.deck[0] : null;
  const aPileTop = g.captures.A.cards.length ? g.captures.A.cards[g.captures.A.cards.length - 1] : null;
  const bPileTop = g.captures.B.cards.length ? g.captures.B.cards[g.captures.B.cards.length - 1] : null;

  return {
    roomId: room.id,
    phase: room.phase,
    players,
    viewerTeam,
    match: room.match
      ? { target: room.match.target, totals: room.match.totals, hand: room.match.hand, winner: room.match.winner, lastHand: room.match.lastHand, rematchReadyCount: room.rematchReady?.size ?? 0 }
      : null,
    matchHistory: history,
    game: {
      round: g.round,
      deckCount: g.deck.length,
      deckOwnerSeat: g.deckOwnerSeat ?? 0,
      deckPeekCard,
      tableTop,
      tableCount,
      hands,
      turnSeat: g.turnSeat,
      lastTakerPlayerId: g.lastTakerPlayerId,
      lastAction: g.lastAction,
      lastDeal: g.lastDeal,
      captures: {
        A: {
          cardsCount: g.captures.A.cards.length,
          pileTop: viewerTeam === "A" ? aPileTop : null,
          cards: viewerTeam === "A" ? g.captures.A.cards : undefined,
          zinga10: aScore.zinga10,
          zinga20: aScore.zinga20,
          zingaPoints: aScore.zingaPoints,
          cardPoints: aScore.cardPoints,
          bonusMostCards: aScore.bonusMostCards,
          total: aScore.total
        },
        B: {
          cardsCount: g.captures.B.cards.length,
          pileTop: viewerTeam === "B" ? bPileTop : null,
          cards: viewerTeam === "B" ? g.captures.B.cards : undefined,
          zinga10: bScore.zinga10,
          zinga20: bScore.zinga20,
          zingaPoints: bScore.zingaPoints,
          cardPoints: bScore.cardPoints,
          bonusMostCards: bScore.bonusMostCards,
          total: bScore.total
        }
      },
      // Intentionally not sending log: memory game
    }
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    io.to(p.socketId).emit("state", sanitizeStateFor(room, p.id));
  }
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, name }, ack) => {
    try {
      const safeRoomId = String(roomId || "").trim().toUpperCase();
      const safeName = String(name || "").trim();

      if (!safeRoomId) throw new Error("Unesite ID sobe.");
      if (!safeName) throw new Error("Unesite ime.");

      const room = getOrCreateRoom(safeRoomId);
      if (room.phase !== "lobby") throw new Error("Igra je već u toku ili završena.");
      if (room.players.length >= 4) throw new Error("Soba je puna.");

      const usedSeats = new Set(room.players.map((p) => p.seat));
      let seat = 0;
      while (usedSeats.has(seat) && seat < 4) seat++;
      if (seat >= 4) throw new Error("Soba je puna.");

      const playerId = randomUUID();
      room.players.push({
        id: playerId,
        name: safeName,
        seat,
        socketId: socket.id,
        connected: true,
        drink: null, // "spricer" | "pivo" | null
        glass: false,
        cigarette: false
      });

      socket.data.roomId = safeRoomId;
      socket.data.playerId = playerId;
      socket.join(safeRoomId);

      if (room.players.length === 4) {
        startGame(room);
      }

      broadcastRoom(room);
      ack?.({ ok: true, playerId, roomId: safeRoomId });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("player:props", ({ drink, glass, cigarette }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      const p = findPlayer(room, playerId);
      if (!p) throw new Error("Igrač nije pronađen.");

      const d = drink === null || drink === undefined ? null : String(drink);
      const allowed = new Set(["spricer", "pivo", null]);
      if (!allowed.has(d)) throw new Error("Nepoznata opcija pića.");

      p.drink = d;
      p.glass = Boolean(glass);
      p.cigarette = Boolean(cigarette);

      broadcastRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("chat:send", ({ text }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      const p = findPlayer(room, playerId);
      if (!p) throw new Error("Igrač nije pronađen.");

      const msg = String(text || "").trim();
      if (!msg) throw new Error("Prazna poruka.");
      if (msg.length > 80) throw new Error("Poruka je predugačka.");

      io.to(roomId).emit("chat:bubble", {
        id: nextActionId(room),
        playerId: p.id,
        seat: p.seat,
        text: msg
      });
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("game:play", ({ cardId }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      applyPlay(room, playerId, String(cardId));
      broadcastRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("rematch:ready", (ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      if (room.phase !== "finished") throw new Error("Igra nije završena.");

      room.rematchReady.add(playerId);

      // Check if all 4 players are ready
      if (room.rematchReady.size === 4) {
        // Reset for new match but keep totals (cumulative score across matches)
        room.match.hand = 0;
        room.match.winner = null;
        room.match.startSeat = 0;
        room.match.lastHand = null;
        room.rematchReady.clear();
        // Start new game (totals are preserved)
        startGame(room);
      }

      broadcastRoom(room);
      ack?.({ ok: true, readyCount: room.rematchReady.size });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("game:leave", (ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");

      const p = findPlayer(room, playerId);
      if (!p) throw new Error("Igrač nije pronađen.");

      // Remove player from room
      room.players = room.players.filter((x) => x.id !== playerId);
      socket.leave(roomId);
      socket.data.roomId = null;
      socket.data.playerId = null;

      // If room is empty, delete it
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        // If game was in progress, abort it
        if (room.phase === "playing") {
          room.phase = "aborted";
          room.game?.log?.push("Igra je prekinuta (igrač je napustio sobu).");
        }
        broadcastRoom(room);
      }

      // Send lobby state to leaving player
      io.to(socket.id).emit("state", {
        roomId: null,
        phase: "lobby",
        players: [],
        match: null,
        game: null
      });

      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const playerId = socket.data.playerId;
    if (!roomId || !playerId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const p = findPlayer(room, playerId);
    if (!p) return;

    // Basic behavior:
    // - If still in lobby: remove player so someone else can join.
    // - If game is playing: abort the game.
    if (room.phase === "lobby") {
      room.players = room.players.filter((x) => x.id !== playerId);
      if (room.players.length === 0) rooms.delete(roomId);
    } else if (room.phase === "playing") {
      room.phase = "aborted";
      room.game?.log?.push("Igra je prekinuta (igrač se diskonektovao).");
      p.connected = false;
    } else {
      p.connected = false;
    }

    if (rooms.has(roomId)) broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Zinga server running on http://localhost:${PORT} (client: ${CLIENT_ORIGIN})`);
});

