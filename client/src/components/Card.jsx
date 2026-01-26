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

export default function Card({ card, onClick, disabled = false, compact = false }) {
  if (!card) return null;
  const suit = suitSymbol(card.suit);
  const color = SUIT_COLOR[suit] || "text-neutral-900";

  const size = compact ? "w-10 h-14" : "w-16 h-24";
  const text = compact ? "text-xs" : "text-sm";

  return (
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
  );
}
