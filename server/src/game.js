/**
 * Game logic for Zinga card game
 */

const SUITS = ["S", "H", "D", "C"]; // Spades, Hearts, Diamonds, Clubs
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/**
 * Create a standard 52-card deck
 */
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        label: `${rank}${suit === "S" ? "♠" : suit === "H" ? "♥" : suit === "D" ? "♦" : "♣"}`
      });
    }
  }
  return deck;
}

/**
 * Shuffle array in place using Fisher-Yates algorithm
 */
export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Determine team for a given seat (0=A, 1=B, 2=A, 3=B)
 */
export function teamForSeat(seat) {
  return seat % 2 === 0 ? "A" : "B";
}

/**
 * Compute team score from captured cards
 * Scoring rules:
 * - A, K, Q, J, 10: 1 point each (except 10♦ = 2 points)
 * - 2♣: 2 points
 * - Most cards (27+): +4 points
 * - Zinga (10): +10 points
 * - Zinga na Žandara (20): +20 points
 */
export function computeTeamScore(captures) {
  const cards = captures.cards || [];
  let cardPoints = 0;
  let zinga10 = captures.zinga10 || 0;
  let zinga20 = captures.zinga20 || 0;
  const bonusMostCards = captures.bonusMostCards || 0;

  for (const card of cards) {
    const { rank, suit } = card;
    if (rank === "A" || rank === "K" || rank === "Q" || rank === "J") {
      cardPoints += 1;
    } else if (rank === "10") {
      // 10♦ (Diamonds) = 2 points, other 10s = 0 points
      if (suit === "D") {
        cardPoints += 2;
      }
    } else if (rank === "2" && suit === "C") {
      // 2♣ = 2 points
      cardPoints += 2;
    }
    // All other cards = 0 points
  }

  const zingaPoints = zinga10 * 10 + zinga20 * 20;
  const total = cardPoints + zingaPoints + bonusMostCards;

  return {
    cardPoints,
    zinga10,
    zinga20,
    zingaPoints,
    bonusMostCards,
    total
  };
}
