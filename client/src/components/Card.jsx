import React from "react";

const SUIT_COLOR = {
  "♠": "text-neutral-900",
  "♣": "text-neutral-900",
  "♥": "text-red-600",
  "♦": "text-red-600"
};

function suitSymbol(suit) {
  switch (suit) {
    case "S":
      return "♠";
    case "H":
      return "♥";
    case "D":
      return "♦";
    case "C":
      return "♣";
    default:
      return suit;
  }
}

// Calculate card points (A=1, J=1, 10♦=2, 2♣=2, others=0)
function getCardPoints(card) {
  if (!card) return 0;
  const { rank, suit } = card;
  if (rank === "A" || rank === "J") {
    return 1;
  } else if (rank === "10" && suit === "D") {
    return 2;
  } else if (rank === "2" && suit === "C") {
    return 2;
  }
  return 0;
}

export default function Card({ card, onClick, disabled = false, compact = false, showPoints = false }) {
  if (!card) return null;
  const suit = suitSymbol(card.suit);
  const color = SUIT_COLOR[suit] || "text-neutral-900";
  const points = showPoints ? getCardPoints(card) : 0;

  const size = compact ? "w-10 h-14" : "w-16 h-24";
  const text = compact ? "text-xs" : "text-sm";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        className={[
          "select-none rounded-lg bg-white shadow-lg ring-1 ring-black/10",
          "flex flex-col justify-between p-2",
          size,
          disabled ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0",
          "transition"
        ].join(" ")}
        aria-label={`Karta ${card.rank}${suit}`}
      >
        <div className={["font-semibold leading-none", text, color].join(" ")}>
          {card.rank}
          {suit}
        </div>
        <div className={["self-end font-semibold leading-none", text, color].join(" ")}>
          {card.rank}
          {suit}
        </div>
      </button>
      {showPoints && points > 0 && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-1 ring-black/20 whitespace-nowrap">
          +{points}
        </div>
      )}
    </div>
  );
}
