import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSocket } from "./socket.js";
import Card from "./components/Card.jsx";
import imgSpricer from "./assets/spricer.png";
import imgPivo from "./assets/pivo.png";
import imgVinjak from "./assets/vinjak.png";
import imgCasa from "./assets/casa.png";
import imgCigareta from "./assets/cigareta.png";
import imgSobranje from "./assets/sobranje.png";
import imgWoodenBackground from "./assets/wooden-background.png";
import imgWoodenDesk from "./assets/wooden-desk.png";
import gameCompletedSound from "./assets/game-completed.wav";
import gameLostSound from "./assets/game-lost.wav";
import glassClinkSound from "./assets/glass-clink.wav";
import cardDropSound from "./assets/card-drop.mp3";
import beerOpenSound from "./assets/beer-open.mp3";
import pivoOpenSound from "./assets/pivo-open.mp3";
import victoryFanfareSound from "./assets/victory-fanfare.mp3";
import cardsTakenSound from "./assets/cards-taken.wav";
import cardDealSound from "./assets/card-deal.mp3";
import doubleKillSound from "./assets/double-kill.mp3";
import tripleKillSound from "./assets/triple-kill.mp3";
import zingaSound from "./assets/zinga.mp3";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function getTeamNames(players) {
  const teamA = players.filter((p) => p.team === "A").map((p) => p.name);
  const teamB = players.filter((p) => p.team === "B").map((p) => p.name);
  return {
    A: teamA.length > 0 ? `Tim ${teamA.join(" + ")}` : "Tim A",
    B: teamB.length > 0 ? `Tim ${teamB.join(" + ")}` : "Tim B"
  };
}

function teamLabel(team, players) {
  const names = getTeamNames(players || []);
  return team === "A" ? names.A : names.B;
}

function relativePos(mySeat, seat) {
  return (seat - mySeat + 4) % 4; // 0=me, 1=left, 2=top, 3=right
}

function SeatBadge({ label, active }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        active ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/30" : "bg-white/10 text-white/80 ring-1 ring-white/10"
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function FlyingCard({ card, fromRel, toOffset, durationMs = 480, onDone }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGo(true));
    const t = setTimeout(() => onDone?.(), durationMs + 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [card?.id, durationMs, onDone]);

  const start =
    fromRel === 0
      ? { left: "50%", top: "86%" } // me (bottom)
      : fromRel === 1
        ? { left: "12%", top: "50%" } // left
        : fromRel === 2
          ? { left: "50%", top: "12%" } // top
          : { left: "88%", top: "50%" }; // right

  const end = {
    left: `calc(50% + ${toOffset.x}px)`,
    top: `calc(50% + ${toOffset.y}px)`
  };

  return (
    <div
      className="absolute pointer-events-none z-40"
      style={{
        left: go ? end.left : start.left,
        top: go ? end.top : start.top,
        transform: go ? "translate(-50%, -50%) scale(0.95)" : "translate(-50%, -50%) scale(1.02)",
        transition: `all ${durationMs}ms cubic-bezier(0.2, 0.9, 0.2, 1)`
      }}
    >
      <Card card={card} />
    </div>
  );
}

function FlyingCardsToPile({ actionId, fromSeat, toSeat, mySeat, cardCount = 3, durationMs = 600, onDone }) {
  const [go, setGo] = useState(false);
  
  useEffect(() => {
    if (!actionId) return;
    const raf = requestAnimationFrame(() => setGo(true));
    const t = setTimeout(() => onDone?.(), durationMs + 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [actionId, durationMs, onDone]);

  // Start position: center of table (where talon is)
  const start = { left: "50%", top: "50%" };

  // End position: captured cards pile position based on toSeat relative to mySeat
  const toRel = relativePos(mySeat, toSeat);
  const endPositions = {
    0: { left: "calc(50% + 320px)", top: "calc(100% - 100px)" }, // me (bottom right, where captured cards button is)
    1: { left: "calc(12% - 80px)", top: "50%" }, // left (left side)
    2: { left: "50%", top: "calc(12% - 80px)" }, // top (top center)
    3: { left: "calc(88% + 80px)", top: "50%" } // right (right side)
  };
  const end = endPositions[toRel] || { left: "50%", top: "50%" };

  // Create multiple cards with slight offset for visual effect
  const cards = [];
  const seed = Number(actionId) || 1;
  const r = mulberry32(seed);
  
  for (let i = 0; i < Math.min(cardCount, 6); i++) {
    const offsetX = (r() - 0.5) * 30;
    const offsetY = (r() - 0.5) * 30;
    const delay = i * 40; // Stagger animation slightly
    const rotation = (r() - 0.5) * 20; // Random rotation
    
    cards.push(
      <div
        key={i}
        className="absolute pointer-events-none z-40"
        style={{
          left: go ? `calc(${end.left} + ${offsetX}px)` : start.left,
          top: go ? `calc(${end.top} + ${offsetY}px)` : start.top,
          transform: go 
            ? `translate(-50%, -50%) scale(0.35) rotate(${rotation}deg)` 
            : `translate(-50%, -50%) scale(0.7) rotate(${(r() - 0.5) * 15}deg)`,
          opacity: go ? 0 : 0.9,
          transition: `all ${durationMs}ms cubic-bezier(0.2, 0.9, 0.2, 1)`,
          transitionDelay: `${delay}ms`
        }}
      >
        <CardBack compact={false} />
      </div>
    );
  }

  return <>{cards}</>;
}

function Confetti({ onComplete }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setShow(false);
      onComplete?.();
    }, 2000);
    return () => clearTimeout(t);
  }, [onComplete]);

  if (!show) return null;

  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F"];
  const pieces = [];

  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 100;
    const y = -10 - Math.random() * 20;
    const delay = Math.random() * 0.5;
    const duration = 1.5 + Math.random() * 1;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rotation = Math.random() * 360;
    const size = 8 + Math.random() * 12;

    pieces.push(
      <div
        key={i}
        className="absolute pointer-events-none"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: color,
          borderRadius: "50%",
          animation: `confetti-fall ${duration}s ${delay}s ease-out forwards`,
          transform: `rotate(${rotation}deg)`
        }}
      />
    );
  }

  return <div className="fixed inset-0 z-50 pointer-events-none">{pieces}</div>;
}

function GameOver({ match, players, socket, playerId, roomId, onLeave, history }) {
  const [confettiDone, setConfettiDone] = useState(false);
  const [rematchClicked, setRematchClicked] = useState(false);
  const [leaveClicked, setLeaveClicked] = useState(false);
  const audioRef = useRef(null);
  const winner = match?.winner;
  const teamNames = useMemo(() => getTeamNames(players || []), [players]);
  const winnerName = winner === "A" ? teamNames.A : teamNames.B;
  const aTotal = match?.totals?.A ?? 0;
  const bTotal = match?.totals?.B ?? 0;
  const readyCount = match?.rematchReadyCount ?? 0;

  // Determine if current player is on winning team
  const currentPlayer = players?.find((p) => p.id === playerId);
  const currentPlayerTeam = currentPlayer?.team || "A";
  const isWinner = currentPlayerTeam === winner;

  // Play sound effect when game ends - different sound for winners vs losers
  useEffect(() => {
    if (audioRef.current) {
      // Set appropriate sound based on whether player won or lost
      audioRef.current.src = isWinner ? victoryFanfareSound : gameLostSound;
      audioRef.current.volume = 0.5; // Set volume to 50%
      audioRef.current.play().catch((err) => {
        // Ignore errors (e.g., user hasn't interacted with page yet)
        console.log("Could not play sound:", err);
      });
    }
    return () => {
      // Cleanup: stop audio if component unmounts
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [isWinner]);

  function handleRematch() {
    if (!socket || rematchClicked || leaveClicked) return;
    setRematchClicked(true);
    socket.emit("rematch:ready", (res) => {
      if (!res?.ok) {
        setRematchClicked(false);
      }
    });
  }

  function handleLeave() {
    if (!socket || leaveClicked || rematchClicked) return;
    setLeaveClicked(true);
    socket.emit("game:leave", (res) => {
      if (res?.ok) {
        onLeave?.();
      } else {
        setLeaveClicked(false);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <audio ref={audioRef} preload="auto" />
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
      {!confettiDone && <Confetti onComplete={() => setConfettiDone(true)} />}
      {confettiDone && (
        <div className="text-center space-y-6 animate-fade-in">
          <div className="text-6xl font-bold text-yellow-400 drop-shadow-[0_0_20px_rgba(255,215,0,0.8)]">
🏆 POBEDNIK IGRE 🏆
          </div>
          <div className="text-4xl font-semibold text-white mt-4">{winnerName}</div>
          <div className="text-2xl text-white/80 mt-6">
            <div>Tim A: {aTotal} poena</div>
            <div>Tim B: {bTotal} poena</div>
          </div>

          {/* History table */}
          {history && history.length > 0 && (
            <div className="mt-6 max-w-md mx-auto">
              <div className="text-lg font-semibold text-white/90 mb-3">Prethodni rezultati</div>
              <div className="rounded-xl bg-black/40 ring-1 ring-white/10 p-3 max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {history.map((h, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm py-2 border-b border-white/10 last:border-0">
                      <div className="text-white/70">
                        {h.winner === "A" ? teamNames.A : teamNames.B} {h.aScore} - {h.bScore}
                      </div>
                      <div className="text-white/50 text-xs">{new Date(h.date).toLocaleDateString("sr-RS")}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex gap-4 justify-center">
            <button
              onClick={handleRematch}
              disabled={rematchClicked || leaveClicked}
              className={[
                "px-8 py-4 rounded-xl text-lg font-semibold transition",
                rematchClicked || leaveClicked
                  ? "bg-emerald-600/50 text-white/60 cursor-not-allowed"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg hover:shadow-xl"
              ].join(" ")}
            >
              {rematchClicked ? `Cekam ostale... (${readyCount}/4)` : "Revans"}
            </button>
            <button
              onClick={handleLeave}
              disabled={leaveClicked || rematchClicked}
              className={[
                "px-8 py-4 rounded-xl text-lg font-semibold transition",
                leaveClicked || rematchClicked
                  ? "bg-gray-600/50 text-white/60 cursor-not-allowed"
                  : "bg-gray-600 hover:bg-gray-700 text-white shadow-lg hover:shadow-xl"
              ].join(" ")}
            >
              {leaveClicked ? "Izlazim..." : "Izadji iz igre"}
            </button>
          </div>
          {readyCount > 0 && readyCount < 4 && rematchClicked && (
            <div className="text-white/60 text-sm mt-2">Spremno: {readyCount}/4 igraca</div>
          )}
        </div>
      )}
    </div>
  );
}

function CenterFx({ fx }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!fx) return;
    setShow(false);
    const raf = requestAnimationFrame(() => setShow(true));
    const dur = fx.durationMs ?? (fx.kind === "deal" ? 2000 : fx.kind === "zinga" ? 2000 : fx.kind === "round" ? 1400 : 1400);
    const t = setTimeout(() => setShow(false), dur);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [fx?.id]);

  if (!fx) return null;

  const isZinga = fx.kind === "zinga";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div
        className={[
          "rounded-2xl px-6 py-4 ring-1 shadow-2xl",
          isZinga ? "bg-white/95 text-blue-900 ring-blue-300/50" : "bg-red-500 text-white ring-white/20",
          "transition-all duration-300",
          show ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-90 -translate-y-6"
        ].join(" ")}
      >
        <div className={`text-2xl font-extrabold tracking-wide ${isZinga ? 'animate-pulse-blue' : ''}`}>
          {fx.title}
        </div>
        {fx.subtitle ? <div className="text-sm opacity-80 mt-1">{fx.subtitle}</div> : null}
      </div>
    </div>
  );
}

function TalonStack({ count, topCard, seed, hideTop, ghostCard }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const n = clamp(count || 0, 0, 999);
  if (!n) return <div className="text-white/80 text-sm">Sto je prazan.</div>;

  const show = clamp(n, 1, 6); // render up to 6 visible layers
  const rand = mulberry32(seed);

  const layers = [];
  for (let i = 0; i < show; i++) {
    const isTopLayer = i === show - 1;
    const rot = (rand() - 0.5) * 18;
    const dx = (rand() - 0.5) * 18;
    const dy = (rand() - 0.5) * 12;
    const z = i;

    layers.push(
      <div
        key={i}
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
          zIndex: z
        }}
      >
        {isTopLayer && topCard && !hideTop ? <Card card={topCard} compact={false} /> : <CardBack compact={false} />}
      </div>
    );
  }

  return (
    <div className="relative w-[320px] h-[300px] sm:w-[340px] sm:h-[320px] md:w-[360px] md:h-[340px]">
      {layers}
      {/* Ghost card - faded outline of last taken card */}
      {ghostCard && !hideTop && (
        <div
          className="absolute left-1/2 top-1/2 pointer-events-none z-5"
          style={{
            transform: "translate(-50%, -50%)",
            opacity: 0.25,
            filter: "blur(1px) grayscale(0.8)"
          }}
        >
          <Card card={ghostCard} compact={false} />
        </div>
      )}
      <div className="absolute left-1/2 top-[78%] -translate-x-1/2 text-xs text-white/80 bg-black/35 ring-1 ring-white/10 rounded-full px-3 py-1">
        Talon: {n}
      </div>
    </div>
  );
}

function DeckStack({ mySeat, deckOwnerSeat, deckCount, deckPeekCard }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!deckCount) return null;

  const ownerRel = relativePos(mySeat, deckOwnerSeat ?? 0);

  // Pozicija relativno u odnosu na igrača koji poseduje spil:
  // Fiksirano dole, ispod imena igrača - horizontalna pozicija zavisi od igrača, vertikalna je uvek dole
  let pos;
  if (ownerRel === 1) {
    // Left: levo dole
    pos = { left: "4%", bottom: "20px" };
  } else if (ownerRel === 3) {
    // Right: desno dole
    pos = { left: "96%", bottom: "20px" };
  } else if (ownerRel === 2) {
    // Top: centar dole (jer je gore, ali deck mora biti dole)
    pos = { left: "50%", bottom: "20px" };
  } else {
    // Bottom (moj deck): centar dole
    pos = { left: "50%", bottom: "20px" };
  }

  // Smanjena visina deck-a: manje layera i manji offset
  const layers = clamp(Math.ceil((deckCount || 0) / 20), 1, 4);
  const backLayers = [];
  for (let i = 0; i < layers; i++) {
    backLayers.push(
      <div
        key={i}
        className="absolute"
        style={{
          left: 0,
          top: 0,
          transform: `translate(${i * 1}px, ${-i * 0.75}px) rotate(${i * 0.75 - 1}deg)`,
          zIndex: i
        }}
      >
        <CardBack compact={true} />
      </div>
    );
  }

  // Duplo manja veličina: w-8 h-12 (bilo w-16 h-24)
  const deckSize = "w-8 h-12";

  return (
    <div 
      className="absolute pointer-events-none" 
      style={{ 
        left: pos.left,
        bottom: pos.bottom,
        transform: "translate(-50%, 0)",
        transformOrigin: "center bottom"
      }}
    >
      <div className={`relative ${deckSize}`}>
        {/* Peek card (last card of deck) - preko spila, samo malo se vidi spil */}
        {deckPeekCard ? (
          <div
            className="absolute left-1/2 bottom-full"
            style={{
              transform: "translate(-50%, 0)",
              zIndex: 15
            }}
          >
            <Card card={deckPeekCard} compact={true} />
          </div>
        ) : null}
        
        {/* Deck layers - malo se vidi ispod karte */}
        <div className="relative" style={{ zIndex: 5, marginTop: deckPeekCard ? "-8px" : "0" }}>
          {backLayers}
        </div>
        
        {/* Ako je kod mene, ispisati koja je karta */}
        {ownerRel === 0 && deckPeekCard ? (
          <div className="absolute left-1/2 top-full mt-1 text-xs text-white/90 font-semibold whitespace-nowrap pointer-events-auto" style={{ transform: "translate(-50%, 0)" }}>
            {deckPeekCard.suit === "hearts" && "♥"}
            {deckPeekCard.suit === "diamonds" && "♦"}
            {deckPeekCard.suit === "clubs" && "♣"}
            {deckPeekCard.suit === "spades" && "♠"}
            {" "}
            {deckPeekCard.rank === "A" ? "A" : deckPeekCard.rank === "K" ? "K" : deckPeekCard.rank === "Q" ? "Q" : deckPeekCard.rank === "J" ? "J" : deckPeekCard.rank}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// (removed) TableDecor: props are now user-selected via "Uzmi pi?e"

function PlayerPropsLayer({ mySeat, players, glassShakePlayerId }) {
  // Deterministic jitter so all clients see same placements
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const seatBase = {
    0: { x: 50, y: 82 }, // bottom
    1: { x: 16, y: 50 }, // left
    2: { x: 50, y: 16 }, // top
    3: { x: 84, y: 50 } // right
  };
  const rightVec = {
    0: { x: 1, y: 0 },
    1: { x: 0, y: -1 },
    2: { x: -1, y: 0 },
    3: { x: 0, y: 1 }
  };
  const toCenter = {
    0: { x: 0, y: -1 },
    1: { x: 1, y: 0 },
    2: { x: 0, y: 1 },
    3: { x: -1, y: 0 }
  };

  const items = [];
  for (const p of players || []) {
    const rel = relativePos(mySeat, p.seat);
    const b = seatBase[rel];
    const rv = rightVec[rel];
    const cv = toCenter[rel];
    const r = mulberry32(hashString(String(p.id || p.name || p.seat)));

    const dx = (r() - 0.5) * 2.2;
    const dy = (r() - 0.5) * 2.2;
    const drot = (r() - 0.5) * 12;
    const crot = (r() - 0.5) * 16;

    const drink = p.drink || null;
    const hasGlass = Boolean(p.glass);
    const hasCig = p.cigarette && p.cigarette !== null;
    const shouldShakeGlass = glassShakePlayerId === p.id && hasGlass;

    const drinkPos = drink ? { x: b.x + rv.x * 15 + dx, y: b.y + rv.y * 15 + dy } : null;

    if (drink) {
      const drinkImg = drink === "spricer" ? imgSpricer : drink === "vinjak" ? imgVinjak : imgPivo;
      const w = drink === "spricer" ? 110 : drink === "vinjak" ? 100 : 106;
      items.push(
        <img
          key={`drink-${p.id}`}
          src={drinkImg}
          alt=""
          className="absolute pointer-events-none opacity-90 drop-shadow-[0_22px_28px_rgba(0,0,0,0.6)]"
          style={{
            left: `${drinkPos.x}%`,
            top: `${drinkPos.y}%`,
            width: w,
            transform: `translate(-50%, -50%) rotate(${drot}deg)`
          }}
        />
      );
    }

    if (hasGlass) {
      // Slightly "forward" (toward center) so it stays visible with drink
      const glassPos = {
        x: b.x + rv.x * 11 + cv.x * 2.0 + dx,
        y: b.y + rv.y * 11 + cv.y * 2.0 + dy
      };
      items.push(
        <img
          key={`glass-${p.id}`}
          src={imgCasa}
          alt=""
          className={`absolute pointer-events-none opacity-85 drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)] ${shouldShakeGlass ? 'animate-shake' : ''}`}
          style={{
            left: `${glassPos.x}%`,
            top: `${glassPos.y}%`,
            width: 86,
            transform: `translate(-50%, -50%) rotate(${(r() - 0.5) * 10}deg)`
          }}
        />
      );
    }

    if (hasCig) {
      // Cigarette: next to drink, aligned, always on player's LEFT side (relative to seat)
      if (hasCig && p.cigarette) {
        const base = drinkPos || { x: b.x + rv.x * 15 + dx, y: b.y + rv.y * 15 + dy };
        const leftOfDrink = { x: base.x - rv.x * 7, y: base.y - rv.y * 7 };
        const cigImg = p.cigarette === "sobranje" ? imgSobranje : imgCigareta;
        items.push(
          <img
            key={`cig-${p.id}`}
            src={cigImg}
            alt=""
            className="absolute pointer-events-none opacity-90 drop-shadow-[0_22px_28px_rgba(0,0,0,0.65)]"
            style={{
              left: `${leftOfDrink.x}%`,
              top: `${leftOfDrink.y}%`,
              width: 90,
              transform: `translate(-50%, -50%) rotate(${crot}deg)`
            }}
          />
        );
      }
    }
  }

  return <>{items}</>;
}

function CardBack({ compact = false }) {
  const size = compact ? "w-10 h-14" : "w-16 h-24";
  return (
    <div
      className={[
        "rounded-lg shadow-lg ring-1 ring-black/10",
        "bg-gradient-to-br from-red-900 to-red-950",
        "relative overflow-hidden",
        size
      ].join(" ")}
      aria-hidden="true"
    >
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.5),transparent_55%)]" />
      <div className="absolute inset-0 opacity-30 bg-[linear-gradient(45deg,rgba(255,255,255,0.4)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.4)_50%,rgba(255,255,255,0.4)_75%,transparent_75%,transparent)] bg-[length:12px_12px]" />
    </div>
  );
}

function CapturedCardsModal({ open, onClose, title, cards }) {
  if (!open) return null;
  const list = Array.isArray(cards) ? cards : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-label="Zatvori"
      />
      <div className="relative w-full max-w-3xl rounded-2xl bg-neutral-950 ring-1 ring-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="text-xs text-white/60">Ukupno: {list.length}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/10 px-3 py-2 text-sm transition"
          >
            Zatvori
          </button>
        </div>

        <div className="mt-4 max-h-[70vh] overflow-auto">
          {list.length ? (
            <div className="flex flex-wrap gap-2">
              {list.map((c) => (
                <Card key={c.id} card={c} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-white/70">Jos uvek niste nosili karte.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Lobby({ onJoin, joining, error, roomId, setRoomId, name, setName, state, gameMode, onBack, ensureSocket, selectedBotMode, setSelectedBotMode, setPlayerId, setJoining, setError }) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:715',message:'Lobby component entry',data:{gameMode,selectedBotMode:selectedBotMode!==undefined?selectedBotMode:'UNDEFINED',hasSetSelectedBotMode:!!setSelectedBotMode,hasSetPlayerId:!!setPlayerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // iOS Safari: unlock audio direktno iz Lobby komponente
  const { unlockAudioDirectly } = useAudioManager();
  
  const players = state?.players || [];
  const teamA = players.filter((p) => p.team === "A");
  const teamB = players.filter((p) => p.team === "B");

  // Debug logging
  console.log("Lobby render:", { gameMode, selectedBotMode, playersLength: players.length, hasSetSelectedBotMode: !!setSelectedBotMode });
  
  // Log start button visibility
  useEffect(() => {
    if (gameMode === "bots") {
      const shouldShow = selectedBotMode !== null && selectedBotMode !== undefined && players.length === 0 && setSelectedBotMode && setPlayerId;
      console.log('[LOBBY] Should show start button?', { 
        gameMode, 
        selectedBotMode, 
        playersLength: players.length, 
        hasSetSelectedBotMode: !!setSelectedBotMode, 
        hasSetPlayerId: !!setPlayerId,
        shouldShow 
      });
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:730',message:'Checking start button visibility',data:{gameMode,selectedBotMode,playersLength:players.length,hasSetSelectedBotMode:!!setSelectedBotMode,hasSetPlayerId:!!setPlayerId,shouldShow},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    }
  }, [gameMode, selectedBotMode, players.length, setSelectedBotMode, setPlayerId]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-2xl font-semibold">Zinga</div>
            <div className="text-white/70 text-sm mt-1">
              {gameMode === "bots" ? "Igraj protiv botova" : "Online kartaska igra 2v2"}
            </div>
          </div>
          <button
            onClick={onBack}
            className="text-xs text-white/60 hover:text-white/80 transition"
          >
            ← Nazad
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-sm text-white/80 mb-1">Ime</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="npr. Marko"
              className="w-full rounded-xl bg-black/30 ring-1 ring-white/10 px-3 py-2 outline-none focus:ring-emerald-400/40"
            />
          </label>
          <label className="block">
            <div className="text-sm text-white/80 mb-1">ID sobe</div>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              placeholder="npr. ZINGA"
              className="w-full rounded-xl bg-black/30 ring-1 ring-white/10 px-3 py-2 outline-none focus:ring-emerald-400/40"
            />
          </label>
        </div>

        {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}

        {/* Bot mode selection - uvek 2v2, socer preko puta */}
        {gameMode === "bots" && players.length === 0 && (selectedBotMode === null || selectedBotMode === undefined) && (
          <div className="mt-8">
            <div className="text-base font-semibold mb-4">Izaberi mod igre:</div>
            <div className="grid grid-cols-1 gap-4">
              <button
                onClick={() => {
                  try {
                    // iOS Safari: unlock audio direktno na button click
                    if (typeof unlockAudioDirectly === 'function') {
                      unlockAudioDirectly();
                    }
                    
                    // #region agent log
                    console.log('[LOBBY] 2v2 button clicked', { hasSetSelectedBotMode: !!setSelectedBotMode, name: name.trim() });
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:772',message:'2v2 (socer across) button clicked',data:{hasSetSelectedBotMode:!!setSelectedBotMode,name:name.trim()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    
                    if (!name.trim()) {
                      setError("Unesite ime.");
                      return;
                    }
                    
                    // #region agent log
                    console.log('[LOBBY] Setting selectedBotMode to 2v2', { hasSetSelectedBotMode: !!setSelectedBotMode });
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:790',message:'Setting selectedBotMode',data:{hasSetSelectedBotMode:!!setSelectedBotMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    
                    if (typeof setSelectedBotMode === 'function') {
                      setSelectedBotMode("2v2");
                      // #region agent log
                      console.log('[LOBBY] selectedBotMode set to 2v2');
                      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:792',message:'selectedBotMode set successfully',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      // #endregion
                    } else {
                      // #region agent log
                      console.error('[LOBBY] setSelectedBotMode is not a function!', { type: typeof setSelectedBotMode, value: setSelectedBotMode });
                      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:795',message:'setSelectedBotMode not available',data:{type:typeof setSelectedBotMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      // #endregion
                    }
                    if (typeof setError === 'function') {
                      setError("");
                    }
                  } catch (err) {
                    console.error('[LOBBY] Error in 2v2 button onClick:', err);
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:808',message:'Error in 2v2 button onClick',data:{error:err.message,stack:err.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  }
                }}
                disabled={!name.trim()}
                className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20 p-6 hover:bg-emerald-500/15 transition disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02]"
              >
                <div className="text-xl font-semibold mb-2">2v2</div>
                <div className="text-sm text-white/70 leading-relaxed">Ti + Bot Partner (preko puta) vs 2 Botovi</div>
              </button>
            </div>
          </div>
        )}

        {/* Start bot game button */}
        {gameMode === "bots" && selectedBotMode !== null && selectedBotMode !== undefined && players.length === 0 && setSelectedBotMode && setPlayerId && (
          <div className="mt-8">
            <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-6 mb-4">
              <div className="text-base font-semibold mb-2">
                Izabran mod: {selectedBotMode === "2v2" ? "2v2 (Ti + Bot Socer vs 2 Botovi)" : "2v2 (Ti + Bot Socer vs 2 Botovi)"}
              </div>
              <div className="text-sm text-white/70">
                Klikni "Pokreni igru" da zapocnes igru sa botovima.
              </div>
            </div>
            <button
              onClick={() => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:870',message:'Start bot game button clicked',data:{name:name.trim(),selectedBotMode,joining,hasSetJoining:!!setJoining,hasSetError:!!setError,hasSetPlayerId:!!setPlayerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                // iOS Safari: unlock audio direktno na button click
                unlockAudioDirectly();
                
                if (!name.trim()) {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:878',message:'Name validation failed',data:{name:name.trim()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                  // #endregion
                  setError("Unesite ime.");
                  return;
                }
                if (!setJoining || !setError || !setPlayerId) {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:882',message:'Missing required functions',data:{setJoining:!!setJoining,setError:!!setError,setPlayerId:!!setPlayerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                  // #endregion
                  console.error("Missing required functions:", { setJoining: !!setJoining, setError: !!setError, setPlayerId: !!setPlayerId });
                  return;
                }
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:889',message:'Setting joining=true before emit',data:{joiningBefore:joining},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                // #endregion
                setJoining(true);
                setError("");
                const s = ensureSocket();
                const handleResponse = (res) => {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:892',message:'room:create-bots response received',data:{ok:res?.ok,error:res?.error,playerId:res?.playerId,hasSetJoining:!!setJoining},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                  
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:897',message:'Setting joining=false after response',data:{ok:res?.ok},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                  // #endregion
                  if (setJoining) setJoining(false);
                  console.log("Bot creation response:", res);
                  if (res?.ok) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:899',message:'Setting playerId from bot creation',data:{playerId:res.playerId,hasSetPlayerId:!!setPlayerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                    // #endregion
                    console.log("Setting playerId:", res.playerId);
                    if (setPlayerId) setPlayerId(res.playerId);
                    // State will be updated via socket "state" event
                  } else {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:907',message:'Bot creation failed',data:{error:res?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    if (setError) setError(res?.error || "Greska.");
                  }
                };
                
                if (!s || !s.connected) {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:911',message:'Socket not connected, waiting for connect',data:{socketExists:!!s,connected:s?.connected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                  // #endregion
                  if (setError) setError("Cekam konekciju sa serverom...");
                  s.once("connect", () => {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:916',message:'Socket connected, emitting room:create-bots',data:{roomId,name,botMode:selectedBotMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    console.log("Socket connected, emitting room:create-bots");
                    s.emit("room:create-bots", { roomId, name, botMode: selectedBotMode }, handleResponse);
                  });
                } else {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:923',message:'Socket already connected, emitting room:create-bots',data:{roomId,name,botMode:selectedBotMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                  console.log("Socket already connected, emitting room:create-bots");
                  s.emit("room:create-bots", { roomId, name, botMode: selectedBotMode }, handleResponse);
                }
              }}
              disabled={joining || !name.trim()}
              className={[
                "w-full rounded-xl px-6 py-3 font-semibold transition",
                "bg-emerald-500 text-black hover:bg-emerald-400 active:bg-emerald-500",
                "disabled:opacity-60 disabled:cursor-not-allowed"
              ].join(" ")}
            >
              {joining ? "Pokretanje igre..." : "Pokreni igru"}
            </button>
            <button
              onClick={() => {
                setSelectedBotMode(null);
                setError("");
              }}
              disabled={joining}
              className="w-full mt-3 rounded-xl px-6 py-2 text-sm text-white/70 hover:text-white/90 transition disabled:opacity-50"
            >
              ← Nazad na izbor moda
            </button>
          </div>
        )}

        {/* Show teams before joining */}
        {players.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20 p-4">
              <div className="text-sm font-semibold mb-2">Tim A</div>
              <div className="space-y-1">
                {teamA.length > 0 ? (
                  teamA.map((p) => (
                    <div key={p.id} className="text-xs text-white/80">
                      {p.name} {p.isBot ? "🤖" : ""}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/40">Prazan</div>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-blue-500/10 ring-1 ring-blue-400/20 p-4">
              <div className="text-sm font-semibold mb-2">Tim B</div>
              <div className="space-y-1">
                {teamB.length > 0 ? (
                  teamB.map((p) => (
                    <div key={p.id} className="text-xs text-white/80">
                      {p.name} {p.isBot ? "🤖" : ""}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/40">Prazan</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Join button - only for multiplayer */}
        {gameMode === "multiplayer" && (
          <button
            type="button"
            onClick={onJoin}
            disabled={joining || !name.trim()}
            className={[
              "mt-5 w-full rounded-xl px-4 py-2.5 font-semibold",
              "bg-emerald-500 text-black hover:bg-emerald-400 active:bg-emerald-500",
              "disabled:opacity-60 disabled:cursor-not-allowed transition"
            ].join(" ")}
          >
            {joining ? "Povezivanje..." : "Udji u sobu"}
          </button>
        )}
      </div>
    </div>
  );
}

function WaitingRoom({ state, playerId, socket }) {
  const players = state?.players || [];
  const me = players.find((p) => p.id === playerId);
  const teamA = players.filter((p) => p.team === "A");
  const teamB = players.filter((p) => p.team === "B");
  const playersWithoutTeam = players.filter((p) => !p.team);
  const missing = Math.max(0, 4 - players.length);
  const canStart = players.length === 4 && teamA.length === 2 && teamB.length === 2;

  function selectTeam(team) {
    // #region agent log
    console.log('[WAITING_ROOM] selectTeam called', { team, hasSocket: !!socket, hasMe: !!me, myTeam: me?.team });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:963',message:'selectTeam called',data:{team,hasSocket:!!socket,hasMe:!!me,myTeam:me?.team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    if (!socket || !me || me.team) {
      // #region agent log
      console.log('[WAITING_ROOM] selectTeam blocked', { hasSocket: !!socket, hasMe: !!me, myTeam: me?.team });
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:965',message:'selectTeam blocked',data:{hasSocket:!!socket,hasMe:!!me,myTeam:me?.team},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return; // Already has team
    }
    
    // iOS Safari: unlock audio direktno na button click
    unlockAudioDirectly();
    
    // #region agent log
    console.log('[WAITING_ROOM] Emitting room:select-team', { team, socketConnected: socket.connected });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:967',message:'Emitting room:select-team',data:{team,socketConnected:socket.connected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    socket.emit("room:select-team", { team }, (res) => {
      // #region agent log
      console.log('[WAITING_ROOM] room:select-team response', res);
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:968',message:'room:select-team response',data:{ok:res?.ok,error:res?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      if (!res?.ok) {
        console.error("Failed to select team:", res?.error);
      }
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-2xl font-semibold">Zinga</div>
            <div className="text-white/70 text-sm mt-1">
              Povezani ste{me ? ` kao ${me.name}` : ""}. Soba: <span className="font-semibold">{state.roomId}</span>
            </div>
          </div>
          <SeatBadge label={canStart ? "Spremno" : `Ceka se: ${missing} igrac`} active={canStart} />
        </div>

        {/* Team Selection - only if player doesn't have a team */}
        {me && !me.team && (
          <div className="mt-6">
            <div className="text-sm font-semibold mb-3">Izaberi tim:</div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => selectTeam("A")}
                disabled={teamA.length >= 2}
                className={[
                  "rounded-xl p-4 ring-1 transition",
                  teamA.length >= 2
                    ? "bg-black/20 ring-white/10 opacity-50 cursor-not-allowed"
                    : "bg-emerald-500/10 ring-emerald-400/20 hover:bg-emerald-500/15"
                ].join(" ")}
              >
                <div className="text-lg font-semibold mb-1">Tim A</div>
                <div className="text-xs text-white/60">
                  {teamA.length}/2 igraca
                </div>
                {teamA.length > 0 && (
                  <div className="mt-2 text-xs text-white/80">
                    {teamA.map((p) => p.name).join(", ")}
                  </div>
                )}
              </button>
              <button
                onClick={() => selectTeam("B")}
                disabled={teamB.length >= 2}
                className={[
                  "rounded-xl p-4 ring-1 transition",
                  teamB.length >= 2
                    ? "bg-black/20 ring-white/10 opacity-50 cursor-not-allowed"
                    : "bg-blue-500/10 ring-blue-400/20 hover:bg-blue-500/15"
                ].join(" ")}
              >
                <div className="text-lg font-semibold mb-1">Tim B</div>
                <div className="text-xs text-white/60">
                  {teamB.length}/2 igraca
                </div>
                {teamB.length > 0 && (
                  <div className="mt-2 text-xs text-white/80">
                    {teamB.map((p) => p.name).join(", ")}
                  </div>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Show current teams */}
        {players.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20 p-4">
              <div className="text-sm font-semibold mb-2">Tim A</div>
              <div className="space-y-1">
                {teamA.length > 0 ? (
                  teamA.map((p) => (
                    <div key={p.id} className="text-xs text-white/80">
                      {p.name} {p.id === playerId ? "(Vi)" : ""}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/40">Prazan</div>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-blue-500/10 ring-1 ring-blue-400/20 p-4">
              <div className="text-sm font-semibold mb-2">Tim B</div>
              <div className="space-y-1">
                {teamB.length > 0 ? (
                  teamB.map((p) => (
                    <div key={p.id} className="text-xs text-white/80">
                      {p.name} {p.id === playerId ? "(Vi)" : ""}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/40">Prazan</div>
                )}
              </div>
            </div>
          </div>
        )}

        {canStart && (
          <div className="mt-6 text-center text-sm text-emerald-300">
            Igra ce poceti uskoro...
          </div>
        )}
      </div>
    </div>
  );
}

// Audio context manager for mobile compatibility
function useAudioManager() {
  const audioContextRef = useRef(null);
  const audioEnabledRef = useRef(false);
  const audioInstancesRef = useRef({});
  const audioUnlockAttemptedRef = useRef(false);
  
  // iOS Safari: eksplicitna funkcija za unlock audio direktno iz button handlera
  const unlockAudioDirectly = useCallback(() => {
    if (audioUnlockAttemptedRef.current) return; // Već pokušano
    audioUnlockAttemptedRef.current = true;
    
    // #region agent log
    console.log('[AUDIO] unlockAudioDirectly called');
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1050',message:'unlockAudioDirectly called',data:{userAgent:navigator.userAgent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    audioEnabledRef.current = true;
    
    const sounds = {
      cardDrop: cardDropSound,
      cardDeal: cardDealSound,
      cardsTaken: cardsTakenSound,
      glassClink: glassClinkSound,
      beerOpen: beerOpenSound,
      pivoOpen: pivoOpenSound,
      doubleKill: doubleKillSound,
      tripleKill: tripleKillSound,
      zinga: zingaSound,
    };
    
    // Kreiraj audio instance SINHRONO
    Object.keys(sounds).forEach((key) => {
      try {
        const audio = new Audio(sounds[key]);
        audio.preload = 'auto';
        audio.volume = key === 'cardDrop' ? 0.3 : 0.4;
        audioInstancesRef.current[key] = audio;
        
        // Pokušaj unlock direktno
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              // #region agent log
              console.log(`[AUDIO] Unlocked ${key}`);
              fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1070',message:'Direct unlock success',data:{soundKey:key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
            })
            .catch((err) => {
              // #region agent log
              console.log(`[AUDIO] Unlock failed ${key}:`, err);
              fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1075',message:'Direct unlock failed',data:{soundKey:key,error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
            });
        }
      } catch (err) {
        // #region agent log
        console.log(`[AUDIO] Failed to create ${key}:`, err);
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1080',message:'Direct unlock creation failed',data:{soundKey:key,error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
      }
    });
    
    // Silent audio unlock za iOS Safari
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      silentAudio.volume = 0.01;
      silentAudio.play().catch(() => {});
    } catch {}
  }, []);

  // Enable audio on first user interaction
  // iOS Safari zahteva da se audio.play() pozove DIREKTNO unutar user gesture handlera (ne async)
  useEffect(() => {
    // Enable on any user interaction (click or touch)
    // iOS Safari: audio mora biti kreiran i odigran SINHRONO unutar handlera
    const enableOnInteraction = (e) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1055',message:'enableOnInteraction called',data:{eventType:e?.type,alreadyEnabled:audioEnabledRef.current,userAgent:navigator.userAgent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      if (audioEnabledRef.current) return; // Već enabled
      
      audioEnabledRef.current = true;
      
      // Pre-create audio instances SINHRONO unutar user gesture-a (za iOS Safari)
      const sounds = {
        cardDrop: cardDropSound,
        cardDeal: cardDealSound,
        cardsTaken: cardsTakenSound,
        glassClink: glassClinkSound,
        beerOpen: beerOpenSound,
        pivoOpen: pivoOpenSound,
        doubleKill: doubleKillSound,
        zinga: zingaSound,
      };
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1069',message:'Creating audio instances',data:{soundKeys:Object.keys(sounds),hasCardDrop:!!sounds.cardDrop,hasCardDeal:!!sounds.cardDeal},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Kreiraj i unlock audio DIREKTNO u handleru (iOS Safari zahteva ovo)
      Object.keys(sounds).forEach((key) => {
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1073',message:'Creating audio element',data:{soundKey:key,hasSource:!!sounds[key]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          
          const audio = new Audio(sounds[key]);
          audio.preload = 'auto';
          audio.volume = key === 'cardDrop' ? 0.3 : 0.4;
          audioInstancesRef.current[key] = audio;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1078',message:'Audio element created',data:{soundKey:key,readyState:audio.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          
          // iOS Safari: play() mora biti pozvan direktno u handleru, ne u Promise chain-u
          // Pokušaj unlock odmah, ali ne čekaj Promise (iOS Safari blokira ako čekaš)
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1083',message:'Audio unlock success',data:{soundKey:key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                audio.pause();
                audio.currentTime = 0;
              })
              .catch((err) => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1087',message:'Audio unlock failed',data:{soundKey:key,error:err?.message||String(err),name:err?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                // Ignore - audio će biti unlocked na prvom pravom play-u
              });
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1090',message:'Audio play returned undefined',data:{soundKey:key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
          }
        } catch (err) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1092',message:'Failed to create audio element',data:{soundKey:key,error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          console.log(`Failed to preload audio ${key}:`, err);
        }
      });
      
      // iOS Safari: dodatni unlock pokušaj sa silent audio
      try {
        const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
        silentAudio.volume = 0.01;
        const silentPromise = silentAudio.play();
        if (silentPromise !== undefined) {
          silentPromise.catch((err) => {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1102',message:'Silent audio unlock failed',data:{error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
          });
        }
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1104',message:'Silent audio creation failed',data:{error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1105',message:'enableOnInteraction completed',data:{instancesCreated:Object.keys(audioInstancesRef.current).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    };
    
    // Add multiple event listeners for better mobile compatibility
    // iOS Safari: koristi capture phase za ranije hvatanje gesture-a
    document.addEventListener('click', enableOnInteraction, { once: true, passive: true, capture: true });
    document.addEventListener('touchstart', enableOnInteraction, { once: true, passive: true, capture: true });
    document.addEventListener('touchend', enableOnInteraction, { once: true, passive: true, capture: true });
    document.addEventListener('mousedown', enableOnInteraction, { once: true, passive: true, capture: true });
    
    return () => {
      document.removeEventListener('click', enableOnInteraction, { capture: true });
      document.removeEventListener('touchstart', enableOnInteraction, { capture: true });
      document.removeEventListener('touchend', enableOnInteraction, { capture: true });
      document.removeEventListener('mousedown', enableOnInteraction, { capture: true });
    };
  }, []);

  const playSound = useCallback((soundKey, volumeOverride = null) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1122',message:'playSound called',data:{soundKey,audioEnabled:audioEnabledRef.current,hasInstance:!!audioInstancesRef.current[soundKey],allInstances:Object.keys(audioInstancesRef.current)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Always try to enable audio if not already enabled
    if (!audioEnabledRef.current) {
      audioEnabledRef.current = true;
    }

    try {
      const audio = audioInstancesRef.current[soundKey];
      if (audio) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1130',message:'Audio instance found, attempting play',data:{soundKey,currentTime:audio.currentTime,readyState:audio.readyState,volume:audio.volume},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        // iOS Safari: reset audio pre svakog play-a za pouzdanije reprodukovanje
        if (audio.currentTime > 0) {
          audio.currentTime = 0;
        }
        
        if (volumeOverride !== null) {
          audio.volume = volumeOverride;
        }
        
        // iOS Safari: pokušaj direktno play, ako ne uspe, probaj clone
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1143',message:'Audio play success',data:{soundKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
            })
            .catch((err) => {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1146',message:'Audio play failed, trying clone',data:{soundKey,error:err?.message||String(err),name:err?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              // Ako direktno play ne radi, probaj sa clone (za overlapping sounds)
              try {
                const clone = audio.cloneNode();
                if (volumeOverride !== null) clone.volume = volumeOverride;
                clone.currentTime = 0;
                const clonePromise = clone.play();
                if (clonePromise !== undefined) {
                  clonePromise
                    .then(() => {
                      // #region agent log
                      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1153',message:'Clone audio play success',data:{soundKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      // #endregion
                    })
                    .catch((cloneErr) => {
                      // #region agent log
                      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1156',message:'Both audio play methods failed',data:{soundKey,error:cloneErr?.message||String(cloneErr)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      // #endregion
                      console.log(`Could not play ${soundKey} sound (both methods failed):`, cloneErr);
                    });
                }
              } catch (cloneErr) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1161',message:'Clone creation failed',data:{soundKey,error:cloneErr?.message||String(cloneErr)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                console.log(`Could not clone/play ${soundKey} sound:`, cloneErr);
              }
            });
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1165',message:'Audio play returned undefined',data:{soundKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1167',message:'Audio instance not found, using fallback',data:{soundKey,allInstances:Object.keys(audioInstancesRef.current)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Fallback: create new audio if preload failed (iOS Safari fallback)
        let soundSrc = null;
        switch (soundKey) {
          case 'cardDrop': soundSrc = cardDropSound; break;
          case 'cardDeal': soundSrc = cardDealSound; break;
          case 'cardsTaken': soundSrc = cardsTakenSound; break;
          case 'glassClink': soundSrc = glassClinkSound; break;
          case 'beerOpen': soundSrc = beerOpenSound; break;
          case 'pivoOpen': soundSrc = pivoOpenSound; break;
        }
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1173',message:'Fallback audio creation',data:{soundKey,hasSoundSrc:!!soundSrc},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (soundSrc) {
          try {
            const audio = new Audio(soundSrc);
            audio.volume = volumeOverride !== null ? volumeOverride : (soundKey === 'cardDrop' ? 0.3 : 0.4);
            audio.currentTime = 0;
            const playPromise = audio.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1181',message:'Fallback audio play success',data:{soundKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                })
                .catch((err) => {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1184',message:'Fallback audio play failed',data:{soundKey,error:err?.message||String(err),name:err?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                  console.log(`Could not play ${soundKey} sound (fallback):`, err);
                });
            }
          } catch (err) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1189',message:'Fallback audio creation exception',data:{soundKey,error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            console.log(`Error creating fallback audio for ${soundKey}:`, err);
          }
        }
      }
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1194',message:'playSound exception',data:{soundKey,error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log(`Error playing ${soundKey} sound:`, err);
    }
  }, []);

  return { playSound, unlockAudioDirectly, audioEnabled: audioEnabledRef.current };
}

function Game({ state, playerId, socket }) {
  const roomPlayers = state.players || [];
  const me = roomPlayers.find((p) => p.id === playerId);
  const g = state.game;
  const { playSound, unlockAudioDirectly } = useAudioManager();
  
  // Early return if game state is not ready
  if (!g) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/70">
        <div className="text-center">
          <div>Ucitavanje igre...</div>
          <div className="mt-2 text-sm text-white/50">Cekam podatke o igri...</div>
        </div>
      </div>
    );
  }

  const [actionError, setActionError] = useState("");
  const [showCaptured, setShowCaptured] = useState(false);
  const [fx, setFx] = useState(null);
  const [flying, setFlying] = useState(null); // {id, card, fromRel, toOffset, hideTop}
  const [flyingToPile, setFlyingToPile] = useState(null); // {id, fromSeat, toSeat, cardCount}
  const [talonOffset, setTalonOffset] = useState({ x: 0, y: 0 });
  const clearFlying = useCallback(() => setFlying(null), []);
  const clearFlyingToPile = useCallback(() => setFlyingToPile(null), []);
  const [showProps, setShowProps] = useState(false);
  const [propsDrink, setPropsDrink] = useState("spricer");
  const [propsGlass, setPropsGlass] = useState(false);
  const [propsCig, setPropsCig] = useState(null); // null | "cigareta" | "sobranje"
  const previousDrinkRef = useRef(null); // Track previous drink to detect changes
  const [chatText, setChatText] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [bubbles, setBubbles] = useState({}); // playerId -> {text, id}
  const [isDealing, setIsDealing] = useState(false);
  const [handRevealCount, setHandRevealCount] = useState(0);
  const [talonDisplayCount, setTalonDisplayCount] = useState(g?.tableCount ?? 0);
  const [hideTalonTopDuringDeal, setHideTalonTopDuringDeal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [glassShakePlayerId, setGlassShakePlayerId] = useState(null);
  const [ghostCard, setGhostCard] = useState(null); // {card, id} - last taken card ghost
  const [lastCardTransition, setLastCardTransition] = useState(null); // {card, fromSeat, id} kad je poslednja karta u spil
  const zingaStreakRef = useRef(0); // Track consecutive zinga count (0, 1, 2, 3+)
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const mySeat = me?.seat ?? 0;
  const myTeam = me?.team ?? "A";
  const isMyTurn = g?.turnSeat === mySeat && state.phase === "playing";

  const byRel = useMemo(() => {
    const map = { 0: null, 1: null, 2: null, 3: null };
    for (const p of roomPlayers) {
      map[relativePos(mySeat, p.seat)] = p;
    }
    return map;
  }, [roomPlayers, mySeat]);

  const myHand = g?.hands?.[playerId]?.cards || [];
  const myCaptured =
    myTeam === "A" ? g?.captures?.A?.cards || [] : g?.captures?.B?.cards || [];
  const myCapturedCount =
    myTeam === "A" ? g?.captures?.A?.cardsCount ?? 0 : g?.captures?.B?.cardsCount ?? 0;
  const myCapturedTop =
    myTeam === "A" ? g?.captures?.A?.pileTop ?? null : g?.captures?.B?.pileTop ?? null;

  const getHandCount = (pid) => g?.hands?.[pid]?.count ?? 0;

  const turnPlayer = roomPlayers.find((p) => p.seat === g?.turnSeat);
  const teamNames = useMemo(() => getTeamNames(roomPlayers), [roomPlayers]);
  const myTeamLabel = myTeam === "A" ? teamNames.A : teamNames.B;

  // Dealing animation (one-by-one reveal) - driven by server deal event
  const latestHandLenRef = useRef(0);
  const latestTableCountRef = useRef(0);
  latestHandLenRef.current = myHand.length;
  latestTableCountRef.current = g?.tableCount ?? 0;

  useEffect(() => {
    if (!g) return;
    const deal = g.lastDeal;
    if (!deal?.id) {
      // No deal event yet: just sync
      setHandRevealCount(myHand.length);
      setTalonDisplayCount(g.tableCount ?? 0);
      setHideTalonTopDuringDeal(false);
      setIsDealing(false);
      return;
    }

    // Start dealing
    setIsDealing(true);
    setHandRevealCount(0);
    
    // Reset zinga streak tracking when a new hand starts
    zingaStreakRef.current = 0;

    // Play card dealing sound when cards are dealt in a new hand
    playSound('cardDeal');

    const isInitial = deal.round === 1;
    if (isInitial) {
      setHideTalonTopDuringDeal(true);
      setTalonDisplayCount(0);
    }

    // FX
    if (deal.isLast) {
      setFx({ id: deal.id, kind: "deal", title: "POSLEDNJE DELJENJE", subtitle: "Nema vise karata u spilu", durationMs: 2000 });
    } else if (isInitial && (deal.hand ?? 1) > 1) {
      setFx({ id: deal.id, kind: "round", title: "NOVA RUNDA", subtitle: `Ruka ${deal.hand}`, durationMs: 1400 });
    }

    const timeouts = [];
    const stepMs = 170;
    for (let i = 1; i <= 4; i++) {
      timeouts.push(
        setTimeout(() => {
          setHandRevealCount(i);
          if (isInitial) setTalonDisplayCount(i);
        }, i * stepMs)
      );
    }

    const finish = () => {
      setHandRevealCount(latestHandLenRef.current);
      setTalonDisplayCount(latestTableCountRef.current);
      setHideTalonTopDuringDeal(false);
      setIsDealing(false);
    };

    // Main end + watchdog end (prevents getting stuck)
    timeouts.push(setTimeout(finish, 4 * stepMs + 260));
    timeouts.push(setTimeout(finish, 2000));

    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [g?.lastDeal?.id]);  

  // Safety fallback: never keep talon/top hidden for long
  useEffect(() => {
    if (!g) return;
    if (!isDealing) return;
    const t = setTimeout(() => {
      setIsDealing(false);
      setHideTalonTopDuringDeal(false);
      setHandRevealCount(myHand.length);
      setTalonDisplayCount(g.tableCount ?? 0);
    }, 2300);
    return () => clearTimeout(t);
  }, [isDealing, myHand.length, g?.tableCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // When not dealing, keep in sync
  useEffect(() => {
    if (!g || isDealing) return;
    setHandRevealCount(myHand.length);
    setTalonDisplayCount(g.tableCount ?? 0);
    setHideTalonTopDuringDeal(false);
  }, [isDealing, myHand.length, g?.tableCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kad je poslednja karta u poslednjem deljenju: duža animacija + "u spil"
  useEffect(() => {
    if (state.phase !== "finished") {
      setLastCardTransition(null);
      return;
    }
    if (!g?.lastAction) return;
    const a = g.lastAction;
    if (!a.isLastCardOfHand || a.type !== "drop" || !a.card) return;
    setLastCardTransition({ card: a.card, fromSeat: a.fromSeat, id: a.id });
    const t = setTimeout(() => setLastCardTransition(null), 2800);
    return () => clearTimeout(t);
  }, [state.phase, g?.lastAction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate last played card + show Zinga / last-deal FX
  useEffect(() => {
    const a = g?.lastAction;
    if (!a?.id || !a?.card) return;

    const rel = relativePos(mySeat, a.fromSeat);
    const seed = Number(a.id) || 1;
    const r = mulberry32(seed);
    const to = { x: Math.round((r() - 0.5) * 34), y: Math.round((r() - 0.5) * 22) };
    setTalonOffset(to);

    // Play card drop sound when card is dropped on table (for all types: drop, take, jack_take)
    if (a.type === "drop" || a.type === "take" || a.type === "jack_take") {
      playSound('cardDrop', 0.3);
    }

    const isLastInDeal = Boolean(a.isLastCardOfHand && a.type === "drop");
    // Card flight (always); duža animacija za poslednju kartu u spil
    setFlying({
      id: a.id,
      card: a.card,
      fromRel: rel,
      toOffset: to,
      hideTop: a.type === "drop",
      durationMs: isLastInDeal ? 1200 : 480
    });

    // Animate cards flying to captured pile when cards are taken
    if (a.type === "take" || a.type === "jack_take") {
      // Play sound when cards are taken
      playSound('cardsTaken');
      
      // Estimate card count based on table count before (we don't have exact count from server)
      // Use the table count from before the action (stored in latestTableCountRef)
      const estimatedCount = Math.min(Math.max(2, latestTableCountRef.current + 1), 8); // +1 for the played card
      setFlyingToPile({
        id: a.id,
        fromSeat: a.fromSeat,
        toSeat: a.fromSeat, // Cards go to the player who took them
        cardCount: estimatedCount
      });
      
      // Show ghost card effect - the last card that was taken
      setGhostCard({ card: a.card, id: a.id });
      // Remove ghost after 1.5 seconds
      const ghostTimeout = setTimeout(() => setGhostCard(null), 1500);
      
      // Zinga FX (check before setting cleanup)
      if (a.zinga === 10 || a.zinga === 20) {
        // Increment streak
        zingaStreakRef.current += 1;
        const streak = zingaStreakRef.current;
        
        if (streak === 3) {
          // Triple kill! Play triple kill sound and zinga sound three times
          playSound('tripleKill', 0.6);
          playSound('zinga', 0.6);
          setTimeout(() => playSound('zinga', 0.6), 100);
          setTimeout(() => playSound('zinga', 0.6), 200);
        } else if (streak === 2) {
          // Double kill! Play both sounds simultaneously
          playSound('zinga', 0.6);
          playSound('doubleKill', 0.6);
        } else {
          // Regular zinga - play zinga sound
          playSound('zinga', 0.6);
        }
        
        if (a.zinga === 10) {
          setFx({ id: a.id, kind: "zinga", title: "ZINGA! +10", subtitle: a.playerName });
        } else if (a.zinga === 20) {
          setFx({ id: a.id, kind: "zinga", title: "ZINGA NA ZANDARA! +20", subtitle: a.playerName });
        }
      } else {
        // Not a zinga, reset streak
        zingaStreakRef.current = 0;
      }
      
      return () => clearTimeout(ghostTimeout);
    } else {
      // Clear ghost when new card is dropped
      setGhostCard(null);
      
      // Zinga FX
      if (a.zinga === 10 || a.zinga === 20) {
        // Increment streak
        zingaStreakRef.current += 1;
        const streak = zingaStreakRef.current;
        
        if (streak === 3) {
          // Triple kill! Play triple kill sound and zinga sound three times
          playSound('tripleKill', 0.6);
          playSound('zinga', 0.6);
          setTimeout(() => playSound('zinga', 0.6), 100);
          setTimeout(() => playSound('zinga', 0.6), 200);
        } else if (streak === 2) {
          // Double kill! Play both sounds simultaneously
          playSound('zinga', 0.6);
          playSound('doubleKill', 0.6);
        } else {
          // Regular zinga - play zinga sound
          playSound('zinga', 0.6);
        }
        
        if (a.zinga === 10) {
          setFx({ id: a.id, kind: "zinga", title: "ZINGA! +10", subtitle: a.playerName });
        } else if (a.zinga === 20) {
          setFx({ id: a.id, kind: "zinga", title: "ZINGA NA ZANDARA! +20", subtitle: a.playerName });
        }
      } else {
        // Not a zinga, reset streak
        zingaStreakRef.current = 0;
      }
    }
  }, [g?.lastAction?.id, mySeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // (removed) old lastDeal/round FX hooks; now driven by server deal event

  // Initialize props modal defaults from current player state
  useEffect(() => {
    const meNow = roomPlayers.find((p) => p.id === playerId);
    if (!meNow) return;
    const currentDrink = meNow.drink || "spricer";
    setPropsDrink(currentDrink);
    setPropsGlass(Boolean(meNow.glass));
    // Handle cigarette: can be boolean (old) or string (new)
    const currentCig = meNow.cigarette;
    if (currentCig === true || currentCig === "cigareta") {
      setPropsCig("cigareta");
    } else if (currentCig === "sobranje") {
      setPropsCig("sobranje");
    } else {
      setPropsCig(null);
    }
    // Initialize previous drink ref
    previousDrinkRef.current = currentDrink;
  }, [roomPlayers, playerId]);

  // Helper function to check if text is only emoji(s)
  function isOnlyEmoji(text) {
    if (!text || text.trim().length === 0) return false;
    // Remove whitespace and check if remaining is only emoji
    const cleaned = text.trim();
    // Unicode emoji ranges: https://stackoverflow.com/questions/18862256/how-to-detect-emoji-using-regular-expression
    const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE00}-\u{FE0F}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F251}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+$/u;
    return emojiRegex.test(cleaned);
  }

  // Chat bubbles
  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => {
      if (!msg?.playerId || !msg?.text) return;
      const id = msg.id ?? Date.now();
      setBubbles((prev) => ({ ...prev, [msg.playerId]: { text: msg.text, id } }));
      setTimeout(() => {
        setBubbles((prev) => {
          const cur = prev[msg.playerId];
          if (!cur || cur.id !== id) return prev;
          const next = { ...prev };
          delete next[msg.playerId];
          return next;
        });
      }, 5000); // Changed to 5 seconds
    };
    socket.on("chat:bubble", handler);
    return () => socket.off("chat:bubble", handler);
  }, [socket]);

  function playCard(card) {
    if (!socket) return;
    // iOS Safari: unlock audio direktno na button click
    unlockAudioDirectly();
    // Play sound immediately when card is clicked (before server response)
    playSound('cardDrop', 0.3);
    setActionError("");
    socket.emit("game:play", { cardId: card.id }, (res) => {
      if (!res?.ok) setActionError(res?.error || "Gre?ka.");
    });
  }

  function saveProps() {
    if (!socket) return;
    const currentDrink = propsDrink || null;
    const drinkChanged = previousDrinkRef.current !== currentDrink;
    
    socket.emit("player:props", { drink: currentDrink, glass: propsGlass, cigarette: propsCig }, (res) => {
      if (!res?.ok) {
        setActionError(res?.error || "Gre?ka.");
        return;
      }
      
      // Update previous drink ref
      previousDrinkRef.current = currentDrink;
      
      // Trigger glass shake animation and sound if glass was selected
      if (propsGlass) {
        setGlassShakePlayerId(playerId);
        setTimeout(() => setGlassShakePlayerId(null), 500);
        
        // Play glass clink sound
        playSound('glassClink');
      }
      
      // Play drink opening sound only if drink changed or is first time
      if (drinkChanged && currentDrink) {
        let drinkSound = null;
        if (currentDrink === "spricer") {
          drinkSound = beerOpenSound;
        } else if (currentDrink === "pivo") {
          drinkSound = pivoOpenSound;
        } else if (currentDrink === "vinjak") {
          drinkSound = beerOpenSound; // Use beer sound for vinjak
        }
        
        if (drinkSound) {
          const soundKey = currentDrink === "spricer" ? 'beerOpen' : currentDrink === "vinjak" ? 'beerOpen' : 'pivoOpen';
          playSound(soundKey);
        }
      }
      
      setShowProps(false);
    });
  }

  function sendChat() {
    const text = chatText.trim();
    if (!socket || !text) return;
    setChatText("");
    socket.emit("chat:send", { text });
  }

  const [screenShake, setScreenShake] = useState(false);
  
  // Trigger screen shake when Zinga happens
  useEffect(() => {
    if (fx?.kind === "zinga") {
      setScreenShake(true);
      const t = setTimeout(() => setScreenShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [fx?.id, fx?.kind]);

  return (
    <div 
      className={`min-h-screen p-4 relative ${screenShake ? 'animate-shake-screen' : ''}`}
      style={imgWoodenBackground ? {
        position: 'relative'
      } : {
        background: 'linear-gradient(135deg, #2c1810 0%, #1a0f08 50%, #2c1810 100%)'
      }}
    >
      {imgWoodenBackground && (
        <div 
          className="fixed inset-0 -z-10"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.4)), url(${imgWoodenBackground})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
            filter: 'blur(3px)',
            transform: 'scale(1.05)'
          }}
        />
      )}
      <CenterFx fx={fx} />
      {showProps ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70" onClick={() => setShowProps(false)} aria-label="Zatvori" />
          <div className="relative w-full max-w-lg rounded-2xl bg-neutral-950 ring-1 ring-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Uzmi pice</div>
                <div className="text-xs text-white/60">Svi vide sta si uzeo.</div>
              </div>
              <button
                type="button"
                onClick={() => setShowProps(false)}
                className="rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/10 px-3 py-2 text-sm transition"
              >
                Zatvori
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { id: "spricer", label: "Spricer", img: imgSpricer },
                { id: "pivo", label: "Pivo", img: imgPivo },
                { id: "vinjak", label: "Vinjak", img: imgVinjak }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPropsDrink(opt.id)}
                  className={[
                    "rounded-2xl bg-black/25 ring-1 p-3 text-left transition",
                    propsDrink === opt.id ? "ring-emerald-400/40 bg-emerald-400/10" : "ring-white/10 hover:bg-black/35"
                  ].join(" ")}
                >
                  <div className="h-20 flex items-center justify-center">
                    <img src={opt.img} alt="" className="max-h-20" />
                  </div>
                  <div className="mt-2 text-sm font-semibold">{opt.label}</div>
                </button>
              ))}
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-white/80 select-none">
              <input type="checkbox" checked={propsGlass} onChange={(e) => setPropsGlass(e.target.checked)} />
              Zelim casu
            </label>

            <div className="mt-4">
              <div className="text-sm text-white/80 mb-2">Cigarete:</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: null, label: "Nema", img: null },
                  { id: "cigareta", label: "Cigareta", img: imgCigareta },
                  { id: "sobranje", label: "Sobranie", img: imgSobranje }
                ].map((opt) => (
                  <button
                    key={opt.id || "none"}
                    type="button"
                    onClick={() => setPropsCig(opt.id)}
                    className={[
                      "rounded-2xl bg-black/25 ring-1 p-3 text-left transition",
                      propsCig === opt.id ? "ring-emerald-400/40 bg-emerald-400/10" : "ring-white/10 hover:bg-black/35"
                    ].join(" ")}
                  >
                    {opt.img ? (
                      <div className="h-20 flex items-center justify-center">
                        <img src={opt.img} alt="" className="max-h-20" />
                      </div>
                    ) : (
                      <div className="h-20 flex items-center justify-center text-white/60">
                        <span className="text-sm">—</span>
                      </div>
                    )}
                    <div className="mt-2 text-sm font-semibold">{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProps(false)}
                className="rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/10 px-3 py-2 text-sm transition"
              >
                Otkazi
              </button>
              <button
                type="button"
                onClick={saveProps}
                className="rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 px-4 py-2 text-sm font-semibold transition"
              >
                Sacuvaj
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <CapturedCardsModal
        open={showCaptured}
        onClose={() => setShowCaptured(false)}
        title={`Nosene karte (${myTeamLabel})`}
        cards={myCaptured}
      />
      {/* Mobile Chat Modal */}
      {showChat ? (
        <div className="fixed inset-0 z-50 flex items-end sm:hidden">
          <button 
            type="button" 
            className="absolute inset-0 bg-black/70" 
            onClick={() => setShowChat(false)} 
            aria-label="Zatvori chat"
          />
          <div className="relative w-full bg-neutral-950 ring-1 ring-white/10 rounded-t-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Chat</div>
              <button
                type="button"
                onClick={() => setShowChat(false)}
                className="rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/10 px-3 py-2 text-sm transition"
              >
                Zatvori
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendChat();
                    setShowChat(false);
                  }
                }}
                placeholder="Napi?i..."
                className="flex-1 bg-black/30 ring-1 ring-white/10 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/40 outline-none focus:ring-emerald-400/40"
                maxLength={80}
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  sendChat();
                  setShowChat(false);
                }}
                className="rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 px-4 py-3 text-sm font-semibold transition min-w-[80px]"
              >
                Posalji
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-semibold">Zinga</div>
            <span className="text-xs text-white/60">Soba: {state.roomId}</span>
          </div>
          <div className="flex items-center gap-2">
            {state.phase === "playing" ? (
              <SeatBadge
                label={isMyTurn ? "Na potezu ste" : `Na potezu: ${turnPlayer ? turnPlayer.name : "?"}`}
                active={isMyTurn}
              />
            ) : state.phase === "finished" ? (
              <SeatBadge label="Kraj igre" active />
            ) : state.phase === "aborted" ? (
              <SeatBadge label="Igra prekinuta" active />
            ) : null}
          </div>
        </div>

        {/* Game Over Overlay — odloži kad je animacija poslednje karte u spil */}
        {state.phase === "finished" && state.match?.winner && !lastCardTransition ? (
          <GameOver
            match={state.match}
            players={roomPlayers}
            socket={socket}
            playerId={playerId}
            roomId={state.roomId}
            onLeave={() => {
              setPlayerId("");
              setState({ phase: "lobby", players: [], roomId: state.roomId, matchHistory: [] });
            }}
            history={state.matchHistory || []}
          />
        ) : null}

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Table */}
          <div
            className={[
              "relative rounded-3xl ring-1 ring-white/10 overflow-hidden",
              "zinga-felt"
            ].join(" ")}
          >
            <div className="absolute inset-0 bg-black/35" />
            <PlayerPropsLayer mySeat={mySeat} players={roomPlayers} glassShakePlayerId={glassShakePlayerId} />
            <DeckStack
              mySeat={mySeat}
              deckOwnerSeat={g?.deckOwnerSeat ?? 0}
              deckCount={g?.deckCount ?? 0}
              deckPeekCard={g?.deckPeekCard ?? null}
            />
            <div className="relative z-10 p-4 h-[72vh] min-h-[520px]">
              <div className="absolute left-4 bottom-4 z-30">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowProps(true)}
                    className="rounded-xl bg-black/35 hover:bg-black/45 ring-1 ring-white/10 px-3 py-2 text-sm text-white/90 transition"
                  >
                    Uzmi pice
                  </button>
                  {/* Desktop: always visible chat */}
                  <div className="hidden sm:flex items-center gap-2 rounded-xl bg-black/35 ring-1 ring-white/10 px-2 py-1">
                    <input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") sendChat();
                      }}
                      placeholder="Napisi..."
                      className="bg-transparent outline-none text-sm text-white/90 placeholder:text-white/40 w-44"
                      maxLength={80}
                    />
                    <button
                      type="button"
                      onClick={sendChat}
                      className="rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-xs text-white/90 transition"
                    >
                      Posalji
                    </button>
                  </div>
                  {/* Mobile: chat button */}
                  <button
                    type="button"
                    onClick={() => setShowChat(true)}
                    className="sm:hidden rounded-xl bg-black/35 hover:bg-black/45 ring-1 ring-white/10 px-3 py-2 text-sm text-white/90 transition"
                    title="Chat"
                  >
                    Chat
                  </button>
                </div>
              </div>
              {isDealing ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                  <div className="rounded-full bg-black/45 ring-1 ring-white/10 px-4 py-2 text-sm text-white/80">
                    Deljenje...
                  </div>
                </div>
              ) : null}
              {/* Flying card overlay */}
              {flying ? (
                <FlyingCard
                  card={flying.card}
                  fromRel={flying.fromRel}
                  toOffset={flying.toOffset}
                  durationMs={flying.durationMs ?? 480}
                  onDone={clearFlying}
                />
              ) : null}
              {/* Flying cards to captured pile */}
              {flyingToPile ? (
                <FlyingCardsToPile
                  actionId={flyingToPile.id}
                  fromSeat={flyingToPile.fromSeat}
                  toSeat={flyingToPile.toSeat}
                  mySeat={mySeat}
                  cardCount={flyingToPile.cardCount}
                  onDone={clearFlyingToPile}
                />
              ) : null}
              {/* Top (socer) */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center">
                {byRel[2]?.id && bubbles[byRel[2].id]?.text ? (
                  <div className={`mb-2 inline-block rounded-2xl bg-black/55 ring-1 ring-white/10 px-3 py-1 text-white/90 animate-chat-fade-out ${
                    isOnlyEmoji(bubbles[byRel[2].id].text) 
                      ? "text-2xl translate-x-2" 
                      : "text-xs"
                  }`}>
                    {bubbles[byRel[2].id].text}
                  </div>
                ) : null}
                <div className="text-white/80 text-sm font-semibold">{byRel[2]?.name || "?"}</div>
                <div className="text-xs text-white/60 mt-0.5">
                  Karte: {getHandCount(byRel[2]?.id)}
                </div>
                {g?.turnSeat === byRel[2]?.seat ? <div className="text-xs text-emerald-200 mt-1">Na potezu</div> : null}
              </div>

              {/* Left opponent */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-left">
                {byRel[1]?.id && bubbles[byRel[1].id]?.text ? (
                  <div className={`mb-2 inline-block rounded-2xl bg-black/55 ring-1 ring-white/10 px-3 py-1 text-white/90 animate-chat-fade-out ${
                    isOnlyEmoji(bubbles[byRel[1].id].text) 
                      ? "text-2xl -translate-x-2" 
                      : "text-xs"
                  }`}>
                    {bubbles[byRel[1].id].text}
                  </div>
                ) : null}
                <div className="text-white/80 text-sm font-semibold">{byRel[1]?.name || "?"}</div>
                <div className="text-xs text-white/60 mt-0.5">
                  Karte: {getHandCount(byRel[1]?.id)}
                </div>
                {g?.turnSeat === byRel[1]?.seat ? <div className="text-xs text-emerald-200 mt-1">Na potezu</div> : null}
              </div>

              {/* Right opponent */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-right">
                {byRel[3]?.id && bubbles[byRel[3].id]?.text ? (
                  <div className={`mb-2 inline-block rounded-2xl bg-black/55 ring-1 ring-white/10 px-3 py-1 text-white/90 animate-chat-fade-out ${
                    isOnlyEmoji(bubbles[byRel[3].id].text) 
                      ? "text-2xl translate-x-2" 
                      : "text-xs"
                  }`}>
                    {bubbles[byRel[3].id].text}
                  </div>
                ) : null}
                <div className="text-white/80 text-sm font-semibold">{byRel[3]?.name || "?"}</div>
                <div className="text-xs text-white/60 mt-0.5">
                  Karte: {getHandCount(byRel[3]?.id)}
                </div>
                {g?.turnSeat === byRel[3]?.seat ? <div className="text-xs text-emerald-200 mt-1">Na potezu</div> : null}
              </div>

              {/* Center table cards */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="flex items-center justify-center"
                  style={{ transform: `translate(${talonOffset.x}px, ${talonOffset.y}px)` }}
                >
                  {lastCardTransition ? (
                    <div className="text-center pointer-events-none">
                      <Card card={lastCardTransition.card} compact={isMobile} />
                      <div className="text-white/90 text-sm mt-2 font-medium">Odigrano — u spil</div>
                    </div>
                  ) : (
                    <TalonStack
                      count={isDealing ? (talonDisplayCount ?? 0) : (g?.tableCount ?? 0)}
                      topCard={isDealing && hideTalonTopDuringDeal ? null : g?.tableTop ?? null}
                      seed={(Number(g?.lastAction?.id || 1) * 13) ^ (g?.tableCount ?? 0)}
                      hideTop={Boolean(flying?.hideTop && g?.tableTop?.id === flying?.card?.id)}
                      ghostCard={ghostCard?.card}
                    />
                  )}
                </div>
              </div>

              {/* Bottom (me) hand */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[min(820px,92%)]">
                {/* Wooden shelf background */}
                <div 
                  className="wooden-shelf rounded-t-3xl pt-2 pb-2 px-3"
                  style={imgWoodenDesk ? {
                    backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.5)), url(${imgWoodenDesk})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center top'
                  } : {}}
                >
                  <div className="flex items-end justify-between mb-1">
                    <div>
                      {byRel[0]?.id && bubbles[byRel[0].id]?.text ? (
                        <div className={`mb-2 inline-block rounded-2xl bg-black/55 ring-1 ring-white/10 px-3 py-1 text-white/90 animate-chat-fade-out ${
                          isOnlyEmoji(bubbles[byRel[0].id].text) 
                            ? "text-2xl translate-x-2" 
                            : "text-xs"
                        }`}>
                          {bubbles[byRel[0].id].text}
                        </div>
                      ) : null}
                      <div className="text-white/90 font-semibold text-sm">{byRel[0]?.name || "Vi"}</div>
                      <div className="text-[10px] text-white/70 mt-0.5">
                        Karte: {myHand.length}
                      </div>
                    </div>
                  <div className="flex items-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCaptured(true)}
                      className="group flex items-center gap-1.5 rounded-lg bg-black/20 ring-1 ring-white/10 px-2 py-1.5 text-[10px] text-white/80 hover:bg-black/30 transition"
                      title="Prika?i no?ene karte"
                    >
                      <div className="relative scale-75">
                        {myCapturedTop ? <Card card={myCapturedTop} compact={true} /> : <CardBack compact={true} />}
                        <div className="absolute -right-1.5 -bottom-1.5 rounded-full bg-emerald-500 text-black text-[8px] font-semibold px-1.5 py-0.5 ring-1 ring-black/20">
                          {myCapturedCount}
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="font-semibold leading-tight text-[10px]">Nase karte</div>
                        <div className="text-white/60 leading-tight text-[9px]">klik za pregled</div>
                      </div>
                    </button>

                    {actionError ? <div className="text-xs text-red-200">{actionError}</div> : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                  {myHand.slice(0, clamp(handRevealCount, 0, myHand.length)).map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      onClick={() => playCard(c)}
                      disabled={!isMyTurn || state.phase !== "playing" || isDealing}
                      showPoints={false}
                      compact={false}
                    />
                  ))}
                  {Array.from({ length: Math.max(0, Math.max(myHand.length, 4) - clamp(handRevealCount, 0, myHand.length)) }).map((_, i) => (
                    <div key={`back-${i}`} className="pointer-events-none">
                      <CardBack compact={false} />
                    </div>
                  ))}
                </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Wooden panel */}
          <div className="wooden-panel rounded-3xl p-4 h-fit">
            <div className="text-sm font-semibold mb-3">Rezultat</div>
            
            {/* Progress bars to 101 */}
            {state?.match ? (
              <div className="space-y-3 mb-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/70">{teamNames.A}</span>
                    <span className="text-xs font-semibold text-white">{state.match.totals.A} / {state.match.target}</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500 ease-out rounded-full"
                      style={{ width: `${Math.min(100, (state.match.totals.A / state.match.target) * 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/70">{teamNames.B}</span>
                    <span className="text-xs font-semibold text-white">{state.match.totals.B} / {state.match.target}</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
                      style={{ width: `${Math.min(100, (state.match.totals.B / state.match.target) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Current hand scores */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className={["rounded-2xl p-3 ring-1", myTeam === "A" ? "bg-emerald-400/10 ring-emerald-400/20" : "bg-black/20 ring-white/10"].join(" ")}>
                <div className="text-xs text-white/60">{teamNames.A}</div>
                <div className="mt-1 text-lg font-semibold">{g?.captures?.A?.total ?? 0}</div>
                <div className="mt-2 space-y-1 text-xs text-white/60">
                  <div>Karte: {g?.captures?.A?.cardsCount ?? 0}</div>
                  <div className="flex items-center gap-2">
                    <span>Zinga:</span>
                    <span className="font-semibold text-emerald-300">{(g?.captures?.A?.zinga10 ?? 0) + (g?.captures?.A?.zinga20 ?? 0)}</span>
                    <span className="text-white/40">({g?.captures?.A?.zinga10 ?? 0}+{g?.captures?.A?.zinga20 ?? 0})</span>
                  </div>
                </div>
              </div>
              <div className={["rounded-2xl p-3 ring-1", myTeam === "B" ? "bg-emerald-400/10 ring-emerald-400/20" : "bg-black/20 ring-white/10"].join(" ")}>
                <div className="text-xs text-white/60">{teamNames.B}</div>
                <div className="mt-1 text-lg font-semibold">{g?.captures?.B?.total ?? 0}</div>
                <div className="mt-2 space-y-1 text-xs text-white/60">
                  <div>Karte: {g?.captures?.B?.cardsCount ?? 0}</div>
                  <div className="flex items-center gap-2">
                    <span>Zinga:</span>
                    <span className="font-semibold text-emerald-300">{(g?.captures?.B?.zinga10 ?? 0) + (g?.captures?.B?.zinga20 ?? 0)}</span>
                    <span className="text-white/40">({g?.captures?.B?.zinga10 ?? 0}+{g?.captures?.B?.zinga20 ?? 0})</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/70">
              <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 p-2">
                <div className="text-white/60 text-xs">Spil</div>
                <div className="mt-0.5 font-semibold text-white text-sm">{g?.deckCount ?? 0}</div>
                {g?.deckCount === 0 ? <div className="mt-0.5 text-[10px] text-red-200 font-semibold">Poslednje deljenje</div> : null}
              </div>
              <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 p-3">
                <div className="text-white/60">Runda</div>
                <div className="mt-1 font-semibold text-white">{g?.round ?? 1}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameModeSelection({ onSelect }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="text-4xl font-bold mb-2">Zinga</div>
          <div className="text-white/70 text-lg">Online Kartaska Igra 2v2</div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Multiplayer Option */}
          <button
            onClick={() => onSelect("multiplayer")}
            className="group rounded-2xl bg-white/5 ring-1 ring-white/10 p-10 hover:bg-white/10 hover:ring-emerald-400/40 transition-all text-left transform hover:scale-[1.02]"
          >
            <div className="text-3xl mb-3">👥</div>
            <div className="text-2xl font-semibold mb-3">Multiplayer</div>
            <div className="text-white/70 text-sm mb-6 leading-relaxed">
              Napravi sobu i pozovi prijatelje da igraju. Igra krece kada se povezu 4 igraca.
            </div>
            <div className="text-emerald-400 text-sm font-semibold group-hover:underline flex items-center gap-2">
              Igraj sa prijateljima <span className="text-lg">→</span>
            </div>
          </button>

          {/* Botovi Option */}
          <button
            onClick={() => onSelect("bots")}
            className="group rounded-2xl bg-white/5 ring-1 ring-white/10 p-10 hover:bg-white/10 hover:ring-emerald-400/40 transition-all text-left transform hover:scale-[1.02]"
          >
            <div className="text-3xl mb-3">🤖</div>
            <div className="text-2xl font-semibold mb-3">Igraj protiv botova</div>
            <div className="text-white/70 text-sm mb-6 leading-relaxed">
              Igraj protiv AI botova. Izaberi da igras sa socerom botom ili sam protiv 3 botova.
            </div>
            <div className="text-emerald-400 text-sm font-semibold group-hover:underline flex items-center gap-2">
              Igraj protiv botova <span className="text-lg">→</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const socketRef = useRef(null);

  const [gameMode, setGameMode] = useState(null); // null | "multiplayer" | "bots"
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("ZINGA");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [selectedBotMode, setSelectedBotMode] = useState(null); // "2v2" | "1v3" | null

  const [playerId, setPlayerId] = useState("");
  const [state, setState] = useState(null);
  
  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2431',message:'Joining state changed',data:{joining,name:name.trim(),selectedBotMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  }, [joining]);
  // #endregion

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      try {
        socketRef.current?.disconnect();
      } catch {
        // ignore
      }
    };
  }, []);

  function ensureSocket() {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2272',message:'ensureSocket called',data:{hasSocket:!!socketRef.current,connected:socketRef.current?.connected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (socketRef.current) {
      // If socket exists but not connected, try to connect
      if (!socketRef.current.connected) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2276',message:'Reconnecting socket',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        socketRef.current.connect();
      }
      return socketRef.current;
    }
    const s = createSocket();
    socketRef.current = s;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2281',message:'Socket created, setting up listeners',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    s.on("state", (next) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2481',message:'State event received',data:{phase:next?.phase,roomId:next?.roomId,hasGame:!!next?.game,playersCount:next?.players?.length,currentPlayerId:playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      console.log("Received state event:", next?.phase, next?.roomId);
      if (next) {
        // Validate state before setting
        if (next.phase === "playing" && !next.game) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2489',message:'Invalid state: playing without game',data:{phase:next.phase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          console.error("Received state with phase='playing' but game is null!");
          setError("Greska: Igra nije spremna. Cekam podatke od servera...");
          return;
        }
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2498',message:'Setting state',data:{phase:next.phase,playersCount:next?.players?.length,hasGame:!!next.game,currentPlayerId:playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.log("Setting state:", next.phase, "players:", next.players?.length);
        setState(next);
        setError(""); // Clear any previous errors
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2502',message:'State set successfully',data:{phase:next.phase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      }
    });
    s.on("connect", () => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2296',message:'Socket connected',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setError(""); // Clear errors on successful connection
    });
    s.on("connect_error", (err) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2299',message:'Socket connect error',data:{error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error("Socket connect error:", err);
      setError("Ne mogu da se povezem sa serverom.");
    });
    s.on("disconnect", (reason) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2303',message:'Socket disconnected',data:{reason},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Don't clear state on intentional disconnects or reconnection attempts
      if (reason === "io server disconnect" || reason === "transport close") {
        // Server or network issue - keep state but show error
        setError("Konekcija sa serverom je prekinuta. Pokusavam ponovo...");
        // Try to reconnect
        setTimeout(() => {
          if (socketRef.current && !socketRef.current.connected) {
            socketRef.current.connect();
          }
        }, 1000);
      }
      // For other disconnects (like "transport error"), don't clear state immediately
    });
    s.on("history", (history) => {
      setState((prev) => (prev ? { ...prev, matchHistory: history } : prev));
    });
    return s;
  }

  function join() {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2323',message:'join called',data:{roomId,name,gameMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    setError("");
    setJoining(true);
    const s = ensureSocket();
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2327',message:'Emitting room:join',data:{roomId,name,gameMode,socketConnected:s.connected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    s.emit("room:join", { roomId, name, gameMode }, (res) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2328',message:'room:join response',data:{ok:res?.ok,error:res?.error,playerId:res?.playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      setJoining(false);
      if (!res?.ok) {
        setError(res?.error || "Greska.");
        return;
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2333',message:'Setting playerId',data:{playerId:res.playerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      setPlayerId(res.playerId);
    });
  }

  // #region agent log
  useEffect(() => {
    console.log('[APP] Render state changed', { gameMode, playerId, selectedBotMode, statePhase: state?.phase, hasState: !!state });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2433',message:'App render state',data:{gameMode,playerId,selectedBotMode,statePhase:state?.phase,hasState:!!state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  }, [gameMode, playerId, selectedBotMode, state?.phase]);
  // #endregion

  // Show game mode selection first
  if (!gameMode) {
    // #region agent log
    console.log('[APP] Rendering GameModeSelection');
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2446',message:'Rendering GameModeSelection',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return <GameModeSelection onSelect={setGameMode} />;
  }

  if (!playerId) {
    // #region agent log
    console.log('[APP] Rendering Lobby (no playerId)', { gameMode, selectedBotMode });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2454',message:'Rendering Lobby (no playerId)',data:{gameMode,selectedBotMode:selectedBotMode!==undefined?selectedBotMode:'UNDEFINED'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return (
      <Lobby
        onJoin={join}
        joining={joining}
        error={error}
        roomId={roomId}
        setRoomId={setRoomId}
        name={name}
        setName={setName}
        state={state}
        gameMode={gameMode}
        onBack={() => {
          setGameMode(null);
          setSelectedBotMode(null);
        }}
        ensureSocket={ensureSocket}
        selectedBotMode={selectedBotMode}
        setSelectedBotMode={setSelectedBotMode}
        setPlayerId={setPlayerId}
        setJoining={setJoining}
        setError={setError}
      />
    );
  }

  if (!state) {
    // #region agent log
    console.log('[APP] No state, showing loading', { playerId, error });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2466',message:'No state, showing loading',data:{playerId,error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return (
      <div className="min-h-screen flex items-center justify-center text-white/70">
        <div className="text-center">
          <div>Ucitavanje stanja...</div>
          {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
        </div>
      </div>
    );
  }

  if (state.phase === "lobby") {
    // #region agent log
    console.log('[APP] Rendering WaitingRoom', { phase: state.phase });
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2477',message:'Rendering WaitingRoom',data:{phase:state.phase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return <WaitingRoom state={state} playerId={playerId} socket={socketRef.current} />;
  }

  if (state.phase === "aborted" || !state.phase) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-xl font-semibold mb-2">Igra je prekinuta</div>
          <button
            onClick={() => {
              setPlayerId("");
              setState(null);
            }}
            className="mt-4 px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition"
          >
            Nazad u lobby
          </button>
        </div>
      </div>
    );
  }

  // Default: render Game component for "playing" or "finished" phases
  try {
    // Guard: don't render Game if game state is missing
    if (state.phase === "playing" && !state.game) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2484',message:'Guard: playing phase without game',data:{phase:state.phase,hasGame:!!state.game},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.error("Phase is 'playing' but state.game is null!");
      return (
        <div className="min-h-screen flex items-center justify-center text-white/70">
          <div className="text-center">
            <div className="text-xl font-semibold mb-2">Greska: Igra nije spremna</div>
            <div className="text-sm text-red-300 mb-4">Cekam podatke o igri od servera...</div>
            <button
              onClick={() => {
                setPlayerId("");
                setState(null);
              }}
              className="mt-4 px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition"
            >
              Nazad u lobby
            </button>
          </div>
        </div>
      );
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2504',message:'Rendering Game component',data:{playerId,statePhase:state?.phase,hasState:!!state,hasGame:!!state?.game},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    return <Game state={state} playerId={playerId} socket={socketRef.current} />;
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b921345b-3c00-4c3a-8da2-24c4d46638c1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:2506',message:'Error rendering Game component',data:{error:err?.message||String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    console.error("Error rendering Game component:", err);
    return (
      <div className="min-h-screen flex items-center justify-center text-white/70">
        <div className="text-center">
          <div className="text-xl font-semibold mb-2">Greska pri ucitavanju igre</div>
          <div className="text-sm text-red-300 mb-4">{err?.message || "Nepoznata greska"}</div>
          <button
            onClick={() => {
              setPlayerId("");
              setState(null);
            }}
            className="mt-4 px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition"
          >
            Nazad u lobby
          </button>
        </div>
      </div>
    );
  }
}

