import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appendFileSync } from "node:fs";
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

  // Reset "send item" state at start of each hand (0:0 in this round)
  room.sendItemUsedThisHand = new Set();

  // Set game first, then phase (to avoid race condition)
  room.game = {
    round: 1,
    deck,
    table: [],
    hands,
    turnSeat: startSeat,
    dealSeat: startSeat,
    deckOwnerSeat: (startSeat + 1) % 4, // Left of first player in counter-clockwise order
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
    triggerBotPlay(room);
  }, 3000); // 3 second delay after game starts (slower bot start)
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
  if (!g) {
    console.error(`[BOT] botPlayCard: No game for bot ${botPlayer.name}`);
    return null;
  }
  
  const hand = g.hands[botPlayer.id] || [];
  if (hand.length === 0) {
    console.log(`[BOT] botPlayCard: Bot ${botPlayer.name} has no cards`);
    return null;
  }
  
  const topCard = g.table.length > 0 ? g.table[g.table.length - 1] : null;
  
  // Strategy 1: OBLIGATORY - If we can take cards, we MUST do it (match rank or Jack)
  if (topCard) {
    // Try to match the top card (same rank) - OBLIGATORY
    const matchingCard = hand.find((c) => c.rank === topCard.rank);
    if (matchingCard) {
      console.log(`[BOT] ${botPlayer.name} taking cards with matching ${matchingCard.rank}`);
      return matchingCard.id;
    }
    
    // Try Jack to take all - OBLIGATORY if table has cards
    const jack = hand.find((c) => c.rank === "J");
    if (jack && g.table.length > 0) {
      console.log(`[BOT] ${botPlayer.name} taking all with Jack`);
      return jack.id;
    }
  }
  
  // Strategy 2: If we can't take, play a random card
  const randomIndex = Math.floor(Math.random() * hand.length);
  const selectedCard = hand[randomIndex];
  console.log(`[BOT] ${botPlayer.name} playing random card: ${selectedCard?.label || 'none'}`);
  return selectedCard?.id || null;
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
    // #region agent log
    const logData = {location:'index.js:384',message:'Cards taken - before assignment',data:{playerId,playerName:player.name,playerTeam:player.team,takenCount:taken.length,teamACardsBefore:g.captures.A.cards.length,teamBCardsBefore:g.captures.B.cards.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
    try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
    // #endregion
    if (!team) {
      // #region agent log
      const logData = {location:'index.js:387',message:'Player has no team!',data:{playerId,playerName:player.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
      // #endregion
      console.error("Player", player.id, "has no team!");
      return; // Safety check
    }
    g.captures[team].cards.push(...taken);
    g.lastTakerPlayerId = playerId;
    // #region agent log
    const logData2 = {location:'index.js:390',message:'Cards taken - after assignment',data:{playerId,playerName:player.name,playerTeam:team,assignedToTeam:team,takenCount:taken.length,teamACardsAfter:g.captures.A.cards.length,teamBCardsAfter:g.captures.B.cards.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
    try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData2) + '\n'); } catch {}
    // #endregion
    
    // Check and update bonus for most cards (27+) immediately
    const aCards = g.captures.A.cards.length;
    const bCards = g.captures.B.cards.length;
    
    // Reset bonuses first
    g.captures.A.bonusMostCards = 0;
    g.captures.B.bonusMostCards = 0;
    
    // Award bonus to team with most cards (27+)
    // If both teams have 27+ cards, only the team with MORE cards gets the bonus
    if (aCards >= 27 || bCards >= 27) {
      if (aCards > bCards) {
        g.captures.A.bonusMostCards = 4;
        g.captures.B.bonusMostCards = 0;
      } else if (bCards > aCards) {
        g.captures.B.bonusMostCards = 4;
        g.captures.A.bonusMostCards = 0;
      } else {
        // Equal cards (both 27+), no bonus
        g.captures.A.bonusMostCards = 0;
        g.captures.B.bonusMostCards = 0;
      }
    }
  }

  // Emit last action for client animations/FX FIRST (before checking for game end)
  g.lastAction = {
    id: nextActionId(room),
    type: actionType,
    fromSeat: player.seat,
    playerId: player.id,
    playerName: player.name,
    card: played,
    zinga: zingaFx
  };

  // Advance turn
  g.turnSeat = nextSeat(g.turnSeat);

  // Check if game should end (101+ points reached) AFTER emitting lastAction
  if (room.match) {
    // Calculate current hand scores (including bonus)
    const aHand = computeTeamScore(g.captures.A);
    const bHand = computeTeamScore(g.captures.B);
    
    // Calculate totals including current hand
    const aTotal = room.match.totals.A + aHand.total;
    const bTotal = room.match.totals.B + bHand.total;
    const target = room.match.target;
    
    // #region agent log
    const logData = {location:'index.js:430',message:'Checking game end condition',data:{roomId:room.id,aTotal,bTotal,target,reachedTarget:aTotal>=target||bTotal>=target,lastActionId:g.lastAction?.id,lastActionCard:g.lastAction?.card?.label,lastActionType:g.lastAction?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
    try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
    // #endregion
    
    // If any team reached target, show the card first, then end game after delay
    if (aTotal >= target || bTotal >= target) {
      // #region agent log
      const logData2 = {location:'index.js:443',message:'Game end triggered - broadcasting last action first',data:{roomId:room.id,aTotal,bTotal,target,lastActionId:g.lastAction?.id,lastActionCard:g.lastAction?.card?.label},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData2) + '\n'); } catch {}
      // #endregion
      
      // Broadcast the last action first so everyone sees the card and what was taken
      broadcastRoom(room);
      
      // Wait for animation to complete (2-3 seconds) before ending the game
      setTimeout(() => {
        const liveRoom = rooms.get(room.id);
        if (!liveRoom) {
          // #region agent log
          const logData3 = {location:'index.js:453',message:'Game end timeout - room not found',data:{roomId:room.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
          try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData3) + '\n'); } catch {}
          // #endregion
          return;
        }
        if (liveRoom.phase !== "playing") {
          // #region agent log
          const logData4 = {location:'index.js:457',message:'Game end timeout - phase already changed',data:{roomId:room.id,phase:liveRoom.phase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
          try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData4) + '\n'); } catch {}
          // #endregion
          return; // Already ended or aborted
        }
        
        // #region agent log
        const logData5 = {location:'index.js:463',message:'Game end timeout - calling endGame',data:{roomId:room.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData5) + '\n'); } catch {}
        // #endregion
        
        // End the current hand to calculate final scores properly
        endGame(liveRoom);
        broadcastRoom(liveRoom);
      }, 2500); // 2.5 seconds delay to show the card and what was taken
      
      return; // Don't continue with normal flow - game will end after delay
    }
  }

  // Deal next round if needed
  if (allHandsEmpty(room)) {
    if (g.deck.length > 0) {
      // Kraj runde, ali ima još karata u špilu:
      // 1) prikaži animaciju poslednje karte / nošenja
      // 2) tek posle male pauze podeli novu ruku
      const before = g.deck.length;
      const currentRound = g.round;
      const dealDelayMs = 1800; // da se jasno vidi ko nosi poslednje karte

      setTimeout(() => {
        const liveRoom = rooms.get(room.id);
        if (!liveRoom) return;
        if (liveRoom.phase !== "playing") return;

        const liveGame = liveRoom.game;
        if (!liveGame) return;

        // Ako se iz nekog razloga stanje promenilo, nemoj duplo deliti
        if (!allHandsEmpty(liveRoom)) return;
        if (liveGame.deck.length !== before) return;

        liveGame.round = currentRound + 1;
        dealFourEach(liveRoom);
        liveGame.log.push("Deljenje: po 4 karte.");

        // Deal event za UI animaciju i oznaku poslednjeg deljenja
        const isLast = before > 0 && liveGame.deck.length === 0;
        liveGame.lastDeal = {
          id: nextActionId(liveRoom),
          isLast,
          round: liveGame.round,
          hand: liveRoom.match?.hand ?? null
        };

        // Pošalji novu ruku svim igračima
        broadcastRoom(liveRoom);

        // Posle animacije deljenja pusti bota
        setTimeout(() => {
          triggerBotPlay(liveRoom);
        }, 3000);
      }, dealDelayMs);
    } else {
      g.lastAction.isLastCardOfHand = true; // UI: duža animacija, karta u spil
      endGame(room);
    }
  } else {
    // Check if next player is a bot and make them play
    triggerBotPlay(room);
  }
}

// Helper function to trigger bot play (recursive for consecutive bots)
function triggerBotPlay(room) {
  const g = room.game;
  if (!g || room.phase !== "playing") {
    console.log(`[BOT] triggerBotPlay: Game not ready (phase: ${room.phase})`);
    return;
  }
  
  const nextPlayer = playerBySeat(room, g.turnSeat);
  if (!nextPlayer) {
    console.log(`[BOT] triggerBotPlay: No player at seat ${g.turnSeat}`);
    return;
  }
  
  if (!nextPlayer.isBot) {
    console.log(`[BOT] triggerBotPlay: Player ${nextPlayer.name} is not a bot`);
    return;
  }
  
  console.log(`[BOT] triggerBotPlay: Bot ${nextPlayer.name} (seat ${nextPlayer.seat}) will play`);
  
  // Bot's turn - play after a short delay
  setTimeout(() => {
    const currentRoom = rooms.get(room.id);
    if (!currentRoom || currentRoom.phase !== "playing") {
      console.log(`[BOT] triggerBotPlay timeout: Room phase changed to ${currentRoom?.phase}`);
      return;
    }
    const currentGame = currentRoom.game;
    if (!currentGame) {
      console.log(`[BOT] triggerBotPlay timeout: No game object`);
      return;
    }
    
    // Double-check it's still this bot's turn
    const currentTurnPlayer = playerBySeat(currentRoom, currentGame.turnSeat);
    if (!currentTurnPlayer || currentTurnPlayer.id !== nextPlayer.id || !currentTurnPlayer.isBot) {
      console.log(`[BOT] triggerBotPlay timeout: Turn changed (expected ${nextPlayer.id}, got ${currentTurnPlayer?.id})`);
      return;
    }
    
    const botCardId = botPlayCard(currentRoom, currentTurnPlayer);
    if (botCardId) {
      try {
        console.log(`[BOT] triggerBotPlay: Bot ${currentTurnPlayer.name} playing card ${botCardId}`);
        applyPlay(currentRoom, currentTurnPlayer.id, botCardId);
        broadcastRoom(currentRoom);
        // applyPlay will call triggerBotPlay again if next player is also a bot
      } catch (err) {
        console.error(`[BOT] Bot play error for ${currentTurnPlayer.name}:`, err);
      }
    } else {
      console.error(`[BOT] Bot ${currentTurnPlayer.name} has no card to play (hand empty?)`);
    }
  }, 2500); // 2.5 second delay for bot to "think" (slower gameplay)
}

function sanitizeStateFor(room, viewerPlayerId) {
  const g = room.game;

  const viewer = viewerPlayerId ? findPlayer(room, viewerPlayerId) : null;
  const viewerTeam = viewer?.team || null; // Team is now selected by player, not based on seat
  // #region agent log
  if (g && viewerPlayerId) {
    const logData = {location:'index.js:577',message:'sanitizeStateFor - viewer info',data:{viewerPlayerId,viewerName:viewer?.name,viewerTeam,teamACards:g.captures.A.cards.length,teamBCards:g.captures.B.cards.length,lastTakerPlayerId:g.lastTakerPlayerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
    try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
  }
  // #endregion

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

  // Send-item: unlocked when one team leads by 15+ in this hand
  const handDiff = Math.abs(aScore.total - bScore.total);
  const sendItemUnlocked = handDiff >= 15;
  const sendItemUsedPlayerIds = Array.from(room.sendItemUsedThisHand || []);

  // #region agent log
  if (viewerPlayerId) {
    const logData = {location:'index.js:609',message:'sanitizeStateFor - scores and cards',data:{viewerPlayerId,viewerTeam,teamAScore:aScore.total,teamBScore:bScore.total,teamACards:g.captures.A.cards.length,teamBCards:g.captures.B.cards.length,willSendTeamACards:viewerTeam==='A',willSendTeamBCards:viewerTeam==='B'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
    try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
  }
  // #endregion

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
      sendItemUnlocked,
      sendItemUsedPlayerIds,
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
  // Also broadcast to all sockets in the room (for players who just joined)
  const roomState = sanitizeStateFor(room, null);
  if (roomState) {
    io.to(room.id).emit("state", roomState);
  }
  
  // Send personalized state to each player
  for (const p of room.players) {
    if (!p.socketId) continue; // Skip bots
    try {
      const state = sanitizeStateFor(room, p.id);
      // #region agent log
      if (state && room.game) {
        const logData = {location:'index.js:702',message:'broadcastRoom - sending personalized state',data:{playerId:p.id,playerName:p.name,playerTeam:p.team,viewerTeam:state.viewerTeam,teamACards:state.game?.captures?.A?.cardsCount,teamBCards:state.game?.captures?.B?.cardsCount,teamAScore:state.game?.captures?.A?.total,teamBScore:state.game?.captures?.B?.total},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
      }
      // #endregion
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
        drink: null, // "spricer" | "pivo" | "vinjak" | null
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
      // #region agent log
      const logData = {location:'index.js:808',message:'room:select-team received',data:{roomId:socket.data.roomId,playerId:socket.data.playerId,team,hasAck:typeof ack==='function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
      // #endregion
      
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) {
        // #region agent log
        const logData = {location:'index.js:813',message:'room:select-team validation failed - not in room',data:{roomId,playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Niste u sobi.");
      }
      const room = rooms.get(roomId);
      if (!room) {
        // #region agent log
        const logData = {location:'index.js:819',message:'room:select-team validation failed - room not found',data:{roomId,availableRooms:Array.from(rooms.keys())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Soba nije pronađena.");
      }
      if (room.phase !== "lobby") {
        // #region agent log
        const logData = {location:'index.js:825',message:'room:select-team validation failed - wrong phase',data:{roomId,phase:room.phase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Igra je već počela.");
      }
      
      const p = findPlayer(room, playerId);
      if (!p) {
        // #region agent log
        const logData = {location:'index.js:832',message:'room:select-team validation failed - player not found',data:{roomId,playerId,playersInRoom:room.players.map(pl=>({id:pl.id,name:pl.name}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Igrač nije pronađen.");
      }
      if (p.team) {
        // #region agent log
        const logData = {location:'index.js:838',message:'room:select-team validation failed - already has team',data:{roomId,playerId,currentTeam:p.team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Već ste izabrali tim.");
      }
      
      if (team !== "A" && team !== "B") {
        // #region agent log
        const logData = {location:'index.js:845',message:'room:select-team validation failed - invalid team',data:{roomId,playerId,team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error("Nevažeći tim.");
      }
      
      // Check if team is full
      const teamCount = room.players.filter((pl) => pl.team === team).length;
      if (teamCount >= 2) {
        // #region agent log
        const logData = {location:'index.js:853',message:'room:select-team validation failed - team full',data:{roomId,playerId,team,teamCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
        // #endregion
        throw new Error(`Tim ${team} je pun.`);
      }
      
      // #region agent log
      const logDataBefore = {location:'index.js:860',message:'room:select-team assigning team',data:{roomId,playerId,team,playerName:p.name,teamCountBefore:teamCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataBefore) + '\n'); } catch {}
      // #endregion
      
      p.team = team;
      
      // Check if we can start game (4 players, 2 per team)
      const teamA = room.players.filter((pl) => pl.team === "A");
      const teamB = room.players.filter((pl) => pl.team === "B");
      
      // #region agent log
      const logDataAfter = {location:'index.js:870',message:'room:select-team after assignment',data:{roomId,playerId,team,playersCount:room.players.length,teamACount:teamA.length,teamBCount:teamB.length,canStart:room.players.length === 4 && teamA.length === 2 && teamB.length === 2},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataAfter) + '\n'); } catch {}
      // #endregion
      
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
        
        // #region agent log
        const logDataStart = {location:'index.js:887',message:'room:select-team starting game',data:{roomId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
        try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataStart) + '\n'); } catch {}
        // #endregion
        
        startGame(room);
        broadcastRoom(room);
        setTimeout(() => broadcastRoom(room), 100);
      } else {
        broadcastRoom(room);
      }
      
      // #region agent log
      const logDataSuccess = {location:'index.js:896',message:'room:select-team success',data:{roomId,playerId,team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataSuccess) + '\n'); } catch {}
      // #endregion
      
      ack?.({ ok: true });
    } catch (e) {
      // #region agent log
      const logDataError = {location:'index.js:901',message:'room:select-team error',data:{error:e?.message||String(e),roomId:socket.data.roomId,playerId:socket.data.playerId,team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataError) + '\n'); } catch {}
      // #endregion
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
      if (botMode !== "2v2") throw new Error("Nevažeći bot mod.");

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
        // For now, assign human to Team A, socer bot to Team A, 2 bots to Team B
        humanPlayer.team = "A";
        humanPlayer.seat = 0;
        
        const partnerBot = {
          id: randomUUID(),
          name: "Bot Socer",
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
        // 1v3 mode changed to 2v2: Human + bot socer (across from human) vs 2 bots
        // Human is at seat 0 (Team A), socer bot is at seat 2 (Team A, across from human)
        // 2 bots are at seats 1 and 3 (Team B)
        humanPlayer.team = "A";
        humanPlayer.seat = 0;
        
        // Socer bot (across from human, seat 2, Team A)
        const partnerBot = {
          id: randomUUID(),
          name: "Bot Socer",
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
        
        // Opponent bots (seats 1 and 3, Team B)
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
      // #region agent log
      const logData = {location:'index.js:1010',message:'player:props received',data:{roomId:socket.data.roomId,playerId:socket.data.playerId,drink,glass,cigarette},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
      // #endregion
      
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      const p = findPlayer(room, playerId);
      if (!p) throw new Error("Igrač nije pronađen.");

      const d = drink === null || drink === undefined ? null : String(drink);
      const allowedDrinks = new Set(["spricer", "pivo", "vinjak", null]);
      if (!allowedDrinks.has(d)) throw new Error("Nepoznata opcija pića.");

      const cig = cigarette === null || cigarette === undefined ? null : String(cigarette);
      const allowedCigarettes = new Set(["cigareta", "sobranje", null]);
      if (!allowedCigarettes.has(cig)) throw new Error("Nepoznata opcija cigareta.");

      // #region agent log
      const logDataBefore = {location:'index.js:1027',message:'player:props before update',data:{roomId,playerId,playerName:p.name,oldDrink:p.drink,newDrink:d,oldGlass:p.glass,newGlass:Boolean(glass),oldCigarette:p.cigarette,newCigarette:cig},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataBefore) + '\n'); } catch {}
      // #endregion

      p.drink = d;
      p.glass = Boolean(glass);
      p.cigarette = cig;

      // #region agent log
      const logDataAfter = {location:'index.js:1035',message:'player:props after update',data:{roomId,playerId,playerName:p.name,drink:p.drink,glass:p.glass,cigarette:p.cigarette,playersInRoom:room.players.map(pl=>({id:pl.id,name:pl.name,drink:pl.drink}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataAfter) + '\n'); } catch {}
      // #endregion

      broadcastRoom(room);
      
      // #region agent log
      const logDataBroadcast = {location:'index.js:1042',message:'player:props broadcast sent',data:{roomId,playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataBroadcast) + '\n'); } catch {}
      // #endregion
      
      ack?.({ ok: true });
    } catch (e) {
      // #region agent log
      const logDataError = {location:'index.js:1047',message:'player:props error',data:{error:e?.message||String(e),roomId:socket.data.roomId,playerId:socket.data.playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logDataError) + '\n'); } catch {}
      // #endregion
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

  socket.on("player:send-item", ({ targetPlayerId, itemType }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      if (room.phase !== "playing" || !room.game) throw new Error("Igra nije u toku.");
      const fromPlayer = findPlayer(room, playerId);
      if (!fromPlayer) throw new Error("Igrač nije pronađen.");
      const toPlayer = findPlayer(room, targetPlayerId);
      if (!toPlayer) throw new Error("Ciljani igrač nije pronađen.");
      if (fromPlayer.team === toPlayer.team) throw new Error("Možete slati samo protivniku.");
      if (toPlayer.isBot) throw new Error("Ne možete slati botu.");
      const aScore = computeTeamScore(room.game.captures.A);
      const bScore = computeTeamScore(room.game.captures.B);
      const handDiff = Math.abs(aScore.total - bScore.total);
      if (handDiff < 15) throw new Error("Opcija se otključava kada jedna ekipa vodi 15+ poena u rundi.");
      if (!room.sendItemUsedThisHand) room.sendItemUsedThisHand = new Set();
      if (room.sendItemUsedThisHand.has(playerId)) throw new Error("Već ste poslali predmet u ovoj rundi.");
      const allowedItems = ["maramice"];
      if (!allowedItems.includes(String(itemType || ""))) throw new Error("Nevažeći predmet.");
      room.sendItemUsedThisHand.add(playerId);
      const expiresAt = Date.now() + 30000; // 30 sekundi kod primaoca
      io.to(roomId).emit("item-sent", {
        fromPlayerId: fromPlayer.id,
        fromPlayerName: fromPlayer.name,
        fromSeat: fromPlayer.seat,
        toPlayerId: toPlayer.id,
        toPlayerName: toPlayer.name,
        toSeat: toPlayer.seat,
        itemType: String(itemType),
        expiresAt
      });
      broadcastRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || "Greška." });
    }
  });

  socket.on("player:send-reaction", ({ reactionId }, ack) => {
    try {
      const roomId = socket.data.roomId;
      const playerId = socket.data.playerId;
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      if (room.phase !== "playing" || !room.game) throw new Error("Igra nije u toku.");
      const g = room.game;
      const last = g.lastAction;
      if (!last || last.zinga !== 10 && last.zinga !== 20) throw new Error("Reakcija je dozvoljena samo nakon Zinge.");
      if (last.playerId !== playerId) throw new Error("Samo igrač koji je uzeo Zingu može poslati reakciju.");
      if (room.reactionSentForActionId === last.id) throw new Error("Reakcija za ovu Zingu je već poslata.");
      const allowedReactions = ["ha-ha", "suiiii", "moo"];
      if (!allowedReactions.includes(String(reactionId || ""))) throw new Error("Nevažeća reakcija.");
      room.reactionSentForActionId = last.id;
      const fromPlayer = findPlayer(room, playerId);
      io.to(roomId).emit("reaction-sent", {
        playerId,
        playerName: fromPlayer?.name || "Igrač",
        fromSeat: fromPlayer?.seat ?? last.fromSeat,
        reactionId: String(reactionId),
        actionId: last.id
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
      // #region agent log
      const logData = {location:'index.js:1050',message:'game:play received',data:{roomId,playerId,cardId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData) + '\n'); } catch {}
      // #endregion
      if (!roomId || !playerId) throw new Error("Niste u sobi.");
      const room = rooms.get(roomId);
      if (!room) throw new Error("Soba nije pronađena.");
      const player = findPlayer(room, playerId);
      // #region agent log
      const logData2 = {location:'index.js:1056',message:'game:play - player info',data:{playerId,playerName:player?.name,playerTeam:player?.team,currentTurnSeat:room.game?.turnSeat,playerSeat:player?.seat},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData2) + '\n'); } catch {}
      // #endregion
      applyPlay(room, playerId, String(cardId));
      broadcastRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      // #region agent log
      const logData3 = {location:'index.js:1061',message:'game:play error',data:{error:e?.message,stack:e?.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};
      try { appendFileSync(join(__dirname, '../../.cursor/debug.log'), JSON.stringify(logData3) + '\n'); } catch {}
      // #endregion
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
