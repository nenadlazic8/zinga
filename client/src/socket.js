import { io } from "socket.io-client";

export function createSocket() {
  const url = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  return io(url, {
    autoConnect: true,
    transports: ["websocket", "polling"]
  });
}

