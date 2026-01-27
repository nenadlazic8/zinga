import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTeamScore, createDeck, shuffleInPlace, teamForSeat } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
// For Railway: allow same origin (frontend and backend on same domain)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ 
  origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN, 
  credentials: true 
}));

// Serve static files from client/dist (if it exists)
// This includes CSS, JS, and other assets
const clientDistPath = join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath, {
  maxAge: '1y', // Cache static assets
  etag: true
}));

app.get("/health", (_req, res) => res.json({ ok: true, name: "zinga-server" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN, 
    credentials: true,
    methods: ["GET", "POST"]
  },
  allowEIO3: true
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
      players: [], // {id, name, seat, socketId, connected, team, isBot}
      game: null,
      gameMode: null, // "multiplayer" | "bots"
      botConfig: null, // {mode: "2v2" | "1v3"} for bots
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
  // Counter-clockwise: 0 -> 3 -> 2 -> 1 -> 0
  return (seat + 3) % 4;
}

function dealFourEach(room) {
  const g = room.game;
  const startSeat = g.dealSeat ?? 0;
  // Deal counter-clockwise: 0 -> 3 -> 2 -> 1 -> 0
  for (let offset = 0; offset < 4; offset++) {
    const seat = (startSeat - offset + 4) % 4; // -offset for counter-clockwise
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

  // Set game first, then phase (to avoid race condition)
  room.game = {
    round: 1,
    deck,
    table: [],
    hands,
    turnSeat: startSeat,
    dealSeat: startSeat,
    deckOwnerSeat: (startSeat - 2 + 4) % 4, // Two seats behind first player in counter-clockwise order (will get last card)
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
  
  // Now set phase after game is fully initialized
  room.phase = "playing";
  
  dealFourEach(room);
  for (let i = 0; i < 4; i++) {
    const c = room.game.deck.pop();
    if (!c) break;
    room.game.table.push(c);
  }
  // Initial deal event for UI animations
  room.game.lastDeal = { id: nextActionId(room), isLast: false, round: 1, hand: room.match?.hand ?? null };
  
  // If first player is a bot, start bot play chain
  setTimeout(() => {
    const currentRoom = rooms.get(room.id);
    if (!currentRoom || currentRoom.phase !== "playing") return;
    const currentGame = currentRoom.game;
    if (!currentGame) return;
    
    const firstPlayer = playerBySeat(currentRoom, currentGame.turnSeat);
    if (firstPlayer && firstPlayer.isBot) {
      const botCardId = botPlayCard(currentRoom, firstPlayer);
      if (botCardId) {
        try {
          applyPlay(currentRoom, firstPlayer.id, botCardId);
          broadcastRoom(currentRoom);
        } catch (err) {
          console.error("Bot play error:", err);
        }
      }
    }
  }, 2000); // 2 second delay after game starts
}

function endGame(room) {
  const g = room.game;
  if (!g) return;

  // Last take: last player who took gets all remaining table cards
  if (g.table.length > 0 && g.lastTakerPlayerId) {
    const lp = findPlayer(room, g.lastTakerPlayerId);
    if (lp && lp.team) {
      const team = lp.team;
      g.captures[team].cards.push(...g.table);
      g.table = [];
      
      // Update bonus for most cards after last take
      const aCards = g.captures.A.cards.length;
      const bCards = g.captures.B.cards.length;
      
      // Reset bonuses first
      g.captures.A.bonusMostCards = 0;
      g.captures.B.bonusMostCards = 0;
      
      // Award bonus to team with most cards (27+)
      if (aCards !== bCards && Math.max(aCards, bCards) >= 27) {
        const winner = aCards > bCards ? "A" : "B";
        g.captures[winner].bonusMostCards = 4;
      }
    }
  }

  // Bonus for most cards is already calculated during play, just ensure it's set correctly
  const aCards = g.captures.A.cards.length;
  const bCards = g.captures.B.cards.length;
  
  // Reset bonuses first
  g.captures.A.bonusMostCards = 0;
  g.captures.B.bonusMostCards = 0;
  
  // Award bonus to team with most cards (27+)
  if (aCards !== bCards && Math.max(aCards, bCards) >= 27) {
    const winner = aCards > bCards ? "A" : "B";
    g.captures[winner].bonusMostCards = 4;
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
      else winner = aTotal >= target ? "A" : "B"; // If tied, first to reach target wins
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

// Bot AI: Take if possible (obligatory), otherwise play random card
function botPlayCard(room, botPlayer) {
  const g = room.game;
  if (!g) return null;
  
  const hand = g.hands[botPlayer.id] || [];
  if (hand.length === 0) return null;
  
  const topCard = g.table.length > 0 ? g.table[g.table.length - 1] : null;
  
  // Strategy 1: OBLIGATORY - If we can take cards, we MUST do it (match rank or Jack)
  if (topCard) {
    // Try to match the top card (same rank) - OBLIGATORY
    const matchingCard = hand.find((c) => c.rank === topCard.rank);
    if (matchingCard) {
      return matchingCard.id;
    }
    
    // Try Jack to take all - OBLIGATORY if table has cards
    const jack = hand.find((c) => c.rank === "J");
    if (jack && g.table.length > 0) {
      return jack.id;
    }
  }
  
  // Strategy 2: If we can't take, play a random card
  const randomIndex = Math.floor(Math.random() * hand.length);
  return hand[randomIndex]?.id || null;
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
        const team = player.team;
        if (team) g.captures[team].zinga20 += 1;
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
        const team = player.team;
        if (team) g.captures[team].zinga10 += 1;
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
    const team = player.team;
    if (!team) {
      console.error("Player", player.id, "has no team!");
      return; // Safety check
    }
    g.captures[team].cards.push(...taken);
    g.lastTakerPlayerId = playerId;
    
    // Check and update bonus for most cards (27+) immediately
    const aCards = g.captures.A.cards.length;
    const bCards = g.captures.B.cards.length;
    
    // Reset bonuses first
    g.captures.A.bonusMostCards = 0;
    g.captures.B.bonusMostCards = 0;
    
    // Award bonus to team with most cards (27+)
    if (aCards !== bCards && Math.max(aCards, bCards) >= 27) {
      const winner = aCards > bCards ? "A" : "B";
      g.captures[winner].bonusMostCards = 4;
    }
    
    // Check if game should end immediately (101+ points reached)
    if (room.match) {
      // Calculate current hand scores (including bonus)
      const aHand = computeTeamScore(g.captures.A);
      const bHand = computeTeamScore(g.captures.B);
      
      // Calculate totals including current hand
      const aTotal = room.match.totals.A + aHand.total;
      const bTotal = room.match.totals.B + bHand.total;
      const target = room.match.target;
      
      // If any team reached target, end game immediately
      if (aTotal >= target || bTotal >= target) {
        // End the current hand first to calculate final scores properly
        endGame(room);
        return; // endGame already broadcasts, so we can return
      }
    }
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
  } else {
    // Check if next player is a bot and make them play
    const nextPlayer = playerBySeat(room, g.turnSeat);
    if (nextPlayer && nextPlayer.isBot && room.phase === "playing") {
      // Bot's turn - play after a short delay
      setTimeout(() => {
        const currentRoom = rooms.get(room.id);
        if (!currentRoom || currentRoom.phase !== "playing") return;
        const currentGame = currentRoom.game;
        if (!currentGame || currentGame.turnSeat !== nextPlayer.seat) return;
        
        const botCardId = botPlayCard(currentRoom, nextPlayer);
        if (botCardId) {
          try {
            applyPlay(currentRoom, nextPlayer.id, botCardId);
            broadcastRoom(currentRoom);
            
            // Continue bot turns if needed (recursive but with delay)
            const nextBotPlayer = playerBySeat(currentRoom, currentGame.turnSeat);
            if (nextBotPlayer && nextBotPlayer.isBot && currentRoom.phase === "playing") {
              setTimeout(() => {
                const botCardId2 = botPlayCard(currentRoom, nextBotPlayer);
                if (botCardId2) {
                  try {
                    applyPlay(currentRoom, nextBotPlayer.id, botCardId2);
                    broadcastRoom(currentRoom);
                  } catch (err) {
                    console.error("Bot play error:", err);
                  }
                }
              }, 1000);
            }
          } catch (err) {
            console.error("Bot play error:", err);
          }
        }
      }, 1500); // 1.5 second delay for bot to "think"
    }
  }
}

function sanitizeStateFor(room, viewerPlayerId) {
  const g = room.game;

  const viewer = viewerPlayerId ? findPlayer(room, viewerPlayerId) : null;
  const viewerTeam = viewer?.team || null; // Team is now selected by player, not based on seat

  const players = room.players
    .slice()
    .sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999))
    .map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat ?? null,
      team: p.team || null, // Team is now selected by player, not based on seat
      connected: p.connected,
      isBot: Boolean(p.isBot),
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
    try {
      const state = sanitizeStateFor(room, p.id);
      if (state) {
        io.to(p.socketId).emit("state", state);
      }
    } catch (err) {
      console.error(`Error broadcasting to player ${p.id}:`, err);
    }
  }
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, name, gameMode }, ack) => {
    try {
      const safeRoomId = String(roomId || "").trim().toUpperCase();
      const safeName = String(name || "").trim();

      if (!safeRoomId) throw new Error("Unesite ID sobe.");
      if (!safeName) throw new Error("Unesite ime.");

      const room = getOrCreateRoom(safeRoomId);
      
      // Set game mode if provided and room is empty
      if (gameMode && room.players.length === 0) {
        room.gameMode = gameMode;
      }
      
      // Check if game is in progress and try to reconnect existing player
      if (room.phase !== "lobby") {
        // Game is in progress - check if player with this name exists
        const existingPlayer = room.players.find((p) => p.name === safeName);
        if (existingPlayer) {
          // Reconnect existing player
          existingPlayer.socketId = socket.id;
          existingPlayer.connected = true;
          
          socket.data.roomId = safeRoomId;
          socket.data.playerId = existingPlayer.id;
          socket.join(safeRoomId);
          
          // Broadcast updated state to all players
          broadcastRoom(room);
          ack?.({ ok: true, playerId: existingPlayer.id, roomId: safeRoomId, reconnected: true });
          return;
        } else {
          // Player with this name doesn't exist - can't join game in progress
          throw new Error("Igra je već u toku. Možete se reconnect-ovati samo sa istim imenom.");
        }
      }
      
      // Lobby phase - normal join logic
      if (room.players.length >= 4) throw new Error("Soba je puna.");

      // Check if player with this name already exists in lobby
      const existingPlayer = room.players.find((p) => p.name === safeName);
      if (existingPlayer) {
        // Reconnect existing player in lobby
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        
        socket.data.roomId = safeRoomId;
        socket.data.playerId = existingPlayer.id;
        socket.join(safeRoomId);
        
        broadcastRoom(room);
        ack?.({ ok: true, playerId: existingPlayer.id, roomId: safeRoomId, reconnected: true });
        return;
      }

      // New player joining lobby - assign seat but no team yet
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
        team: null, // Player will select team
        isBot: false,
        drink: null, // "spricer" | "pivo" | null
        glass: false,
        cigarette: false
      });

      socket.data.roomId = safeRoomId;
      socket.data.playerId = playerId;
      socket.join(safeRoomId);

      broadcastRoom(room);
      ack?.({ ok: true, playerId, roomId: safeRoomId });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  // Handle team selection
  socket.on("room:select-team", ({ team }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      if (room.phase !== "lobby") throw new Error("Igra je već počela.");
      
      const p = findPlayer(room, playerId);
      if (!p) throw new Error("Igrač nije pronađen.");
      if (p.team) throw new Error("Već ste izabrali tim.");
      
      if (team !== "A" && team !== "B") throw new Error("Nevažeći tim.");
      
      // Check if team is full
      const teamCount = room.players.filter((pl) => pl.team === team).length;
      if (teamCount >= 2) throw new Error(`Tim ${team} je pun.`);
      
      p.team = team;
      
      // Check if we can start game (4 players, 2 per team)
      const teamA = room.players.filter((pl) => pl.team === "A");
      const teamB = room.players.filter((pl) => pl.team === "B");
      
      if (room.players.length === 4 && teamA.length === 2 && teamB.length === 2) {
        // Assign seats based on teams (A: seats 0,2; B: seats 1,3)
        let seatA = 0;
        let seatB = 1;
        for (const pl of room.players) {
          if (pl.team === "A") {
            pl.seat = seatA;
            seatA += 2;
          } else if (pl.team === "B") {
            pl.seat = seatB;
            seatB += 2;
          }
        }
        
        startGame(room);
        broadcastRoom(room);
        setTimeout(() => broadcastRoom(room), 100);
      } else {
        broadcastRoom(room);
      }
      
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  // Handle bot game creation
  socket.on("room:create-bots", ({ roomId, name, botMode }, ack) => {
    try {
      const safeRoomId = String(roomId || "").trim().toUpperCase();
      const safeName = String(name || "").trim();
      
      if (!safeRoomId) throw new Error("Unesite ID sobe.");
      if (!safeName) throw new Error("Unesite ime.");
      if (botMode !== "2v2" && botMode !== "1v3") throw new Error("Nevažeći bot mod.");

      const room = getOrCreateRoom(safeRoomId);
      room.gameMode = "bots";
      room.botConfig = { mode: botMode };
      
      if (room.phase !== "lobby") throw new Error("Soba je već u upotrebi.");
      if (room.players.length > 0) throw new Error("Soba nije prazna.");

      // Create human player
      const playerId = randomUUID();
      const humanPlayer = {
        id: playerId,
        name: safeName,
        seat: null, // Will be assigned when teams are set
        socketId: socket.id,
        connected: true,
        team: null, // Will be selected
        isBot: false,
        drink: null,
        glass: false,
        cigarette: false
      };
      room.players.push(humanPlayer);

      // Create bots based on mode
      const botNames = ["Bot1", "Bot2", "Bot3"];
      if (botMode === "2v2") {
        // Human + 1 bot vs 2 bots
        // Human selects team first, then bots fill remaining spots
        // For now, assign human to Team A, partner bot to Team A, 2 bots to Team B
        humanPlayer.team = "A";
        humanPlayer.seat = 0;
        
        const partnerBot = {
          id: randomUUID(),
          name: "Bot Partner",
          seat: 2,
          socketId: null,
          connected: true,
          team: "A",
          isBot: true,
          drink: null,
          glass: false,
          cigarette: false
        };
        room.players.push(partnerBot);
        
        const bot1 = {
          id: randomUUID(),
          name: "Bot Protivnik 1",
          seat: 1,
          socketId: null,
          connected: true,
          team: "B",
          isBot: true,
          drink: null,
          glass: false,
          cigarette: false
        };
        room.players.push(bot1);
        
        const bot2 = {
          id: randomUUID(),
          name: "Bot Protivnik 2",
          seat: 3,
          socketId: null,
          connected: true,
          team: "B",
          isBot: true,
          drink: null,
          glass: false,
          cigarette: false
        };
        room.players.push(bot2);
      } else {
        // 1v3: Human + 3 bots (human is alone)
        humanPlayer.team = "A";
        humanPlayer.seat = 0;
        
        for (let i = 0; i < 3; i++) {
          room.players.push({
            id: randomUUID(),
            name: `Bot ${i + 1}`,
            seat: i + 1,
            socketId: null,
            connected: true,
            team: "B",
            isBot: true,
            drink: null,
            glass: false,
            cigarette: false
          });
        }
      }

      socket.data.roomId = safeRoomId;
      socket.data.playerId = playerId;
      socket.join(safeRoomId);

      // Start game immediately
      startGame(room);
      broadcastRoom(room);
      setTimeout(() => broadcastRoom(room), 100);
      
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

    // Mark player as disconnected but don't immediately abort
    // Give them a chance to reconnect (Socket.io will auto-reconnect)
    p.connected = false;

    // Basic behavior:
    // - If still in lobby: remove player so someone else can join (they can reconnect with same name).
    // - If game is playing: mark as disconnected but don't remove (they can reconnect with same name).
    // - Only abort if ALL players are disconnected for a while (handled elsewhere if needed).
    if (room.phase === "lobby") {
      // In lobby, remove disconnected player (they can reconnect with same name)
      room.players = room.players.filter((x) => x.id !== playerId);
      if (room.players.length === 0) rooms.delete(roomId);
    } else if (room.phase === "playing" || room.phase === "finished") {
      // In game, keep player but mark as disconnected (they can reconnect)
      // Don't abort immediately - give them chance to reconnect
    }

    if (rooms.has(roomId)) broadcastRoom(room);
  });
});

// Serve React app for all non-API routes (SPA routing)
app.get('*', (req, res, next) => {
  // Skip API and Socket.io routes
  if (req.path.startsWith('/health') || req.path.startsWith('/socket.io')) {
    return next();
  }
  // Skip static assets (CSS, JS, images, etc.) - they're handled by express.static
  const ext = req.path.split('.').pop();
  const staticExtensions = ['css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot'];
  if (staticExtensions.includes(ext)) {
    return next(); // Let express.static handle it
  }
  res.sendFile(join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      // If client/dist doesn't exist, continue (backend-only mode)
      next();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Zinga server running on http://localhost:${PORT} (client: ${CLIENT_ORIGIN})`);
});
