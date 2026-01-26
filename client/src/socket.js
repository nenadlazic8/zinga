import { io } from "socket.io-client";

export function createSocket() {
  // If VITE_SERVER_URL is set (for separate frontend/backend), use it
  // Otherwise, use empty string to connect to same origin (Railway deployment)
  const url = import.meta.env.VITE_SERVER_URL || "";
  return io(url, {
    autoConnect: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    timeout: 20000
  });
}
