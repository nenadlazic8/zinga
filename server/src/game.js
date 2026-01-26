import { randomUUID } from "node:crypto";

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

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

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}${suit}-${randomUUID()}`,
        rank,
        suit,
        label: `${rank}${suitSymbol(suit)}`
      });
    }
  }
  return deck;
}

export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function teamForSeat(seat) {
  // Team A: seats 0 & 2 (Players 1 & 3), Team B: seats 1 & 3 (Players 2 & 4)
  return seat % 2 === 0 ? "A" : "B";
}

export function pointsForCard(card) {
  // A, K, Q, J = 1 point
  // 10♦ (Velika desetka) = 2 points (other 10s are 0)
  // 2♣ (Mala dvojka) = 2 points
  if (!card) return 0;
  if (card.rank === "10" && card.suit === "D") return 2;
  if (card.rank === "2" && card.suit === "C") return 2;
  if (card.rank === "A" || card.rank === "K" || card.rank === "Q" || card.rank === "J") return 1;
  return 0;
}

export function computeTeamScore(teamCapture) {
  const cardPoints = teamCapture.cards.reduce((sum, c) => sum + pointsForCard(c), 0);
  const zinga10 = teamCapture.zinga10 || 0;
  const zinga20 = teamCapture.zinga20 || 0;
  const zingaPoints = zinga10 * 10 + zinga20 * 20;
  const bonusMostCards = teamCapture.bonusMostCards || 0;
  return {
    cardPoints,
    zinga10,
    zinga20,
    zingaPoints,
    bonusMostCards,
    total: cardPoints + zingaPoints + bonusMostCards
  };
}

