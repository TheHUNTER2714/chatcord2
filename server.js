const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: [
      "https://chatcord-rp4q.onrender.com",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

// === In-Memory Data ===
const rooms = new Map(); // Map<roomCode, { name, code, users: [], ownerId, joinRequests: [] }>
const userRooms = new Map(); // Map<socket.id, roomCode>

// === Generate Room Code ===
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

// === Socket.IO Logic ===
io.on("connection", (socket) => {
  console.log("✅ New connection:", socket.id);

  // === Create Room ===
  socket.on("create_room", ({ roomName, user }) => {
    const code = generateRoomCode();
    const room = {
      name: roomName,
      code,
      ownerId: socket.id,
      users: [{ id: socket.id, name: user.name }],
      joinRequests: []
    };

    rooms.set(code, room);
    userRooms.set(socket.id, code);
    socket.join(code);

    socket.emit("room_created", room);
    console.log(`📦 Room created: ${code}`);
  });

  // === Request to Join Room ===
  socket.on("request_join", ({ roomCode, user }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("room_not_found");
      return;
    }

    // Add to joinRequests
    room.joinRequests.push({ id: socket.id, name: user.name });
    const ownerSocket = io.sockets.sockets.get(room.ownerId);

    if (ownerSocket) {
      ownerSocket.emit("join_request", {
        user,
        socketId: socket.id,
        roomCode
      });
    }
  });

  // === Approve Join Request ===
  socket.on("approve_join", ({ socketId, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.ownerId !== socket.id) return;

    const requestIndex = room.joinRequests.findIndex(r => r.id === socketId);
    if (requestIndex === -1) return;

    const user = room.joinRequests.splice(requestIndex, 1)[0];
    room.users.push({ id: socketId, name: user.name });

    const userSocket = io.sockets.sockets.get(socketId);
    if (userSocket) {
      userRooms.set(socketId, roomCode);
      userSocket.join(roomCode);
      userSocket.emit("room_joined", { room, users: room.users });
      socket.to(roomCode).emit("user_joined", user);
    }
  });

  // === Reject Join Request ===
  socket.on("reject_join", ({ socketId, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.ownerId !== socket.id) return;

    room.joinRequests = room.joinRequests.filter(r => r.id !== socketId);
    const userSocket = io.sockets.sockets.get(socketId);
    if (userSocket) {
      userSocket.emit("join_rejected", { roomCode });
    }
  });

  // === Kick User ===
  socket.on("kick_user", ({ roomCode, userId }) => {
    const room = rooms.get(roomCode);
    if (!room || room.ownerId !== socket.id) return;

    room.users = room.users.filter(u => u.id !== userId);
    const targetSocket = io.sockets.sockets.get(userId);

    if (targetSocket) {
      targetSocket.leave(roomCode);
      userRooms.delete(userId);
      targetSocket.emit("kicked", { roomCode });
    }

    socket.to(roomCode).emit("user_kicked", { userId });
  });

  // === Messaging, Typing, and Others (unchanged) ===
  socket.on("send_message", (message) => {
    const roomCode = message.roomCode;
    const timestamp = new Date().toISOString();
    const messageWithTimestamp = { ...message, timestamp };

    const room = rooms.get(roomCode);
    if (!room) return;

    const mentionedUser = room.users.find(u =>
      message.text.includes(`@${u.name}`)
    );
    if (mentionedUser) {
      io.to(mentionedUser.id).emit("notification", {
        type: "mention",
        message: `You were mentioned by ${message.user.name}`
      });
    }

    socket.to(roomCode).emit("new_message", messageWithTimestamp);
    socket.emit("new_message", messageWithTimestamp);
  });

  socket.on("typing", ({ roomCode, userName }) => {
    socket.to(roomCode).emit("typing", { userName });
  });

  socket.on("stop_typing", ({ roomCode, userName }) => {
    socket.to(roomCode).emit("stop_typing", { userName });
  });

  socket.on("leave_room", ({ roomCode, userId }) => {
    const room = rooms.get(roomCode);
    if (room) {
      const user = room.users.find(u => u.id === userId);
      room.users = room.users.filter(u => u.id !== userId);
      socket.leave(roomCode);
      userRooms.delete(socket.id);
      socket.to(roomCode).emit("user_left", { id: userId });
    }
  });

  socket.on("disconnect", () => {
    const roomCode = userRooms.get(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const user = room.users.find(u => u.id === socket.id);
    room.users = room.users.filter(u => u.id !== socket.id);
    socket.to(roomCode).emit("user_left", { id: socket.id });
    userRooms.delete(socket.id);

    if (room.ownerId === socket.id) {
      // Owner disconnected, remove room and notify users
      io.to(roomCode).emit("notification", {
        type: "room_closed",
        message: "Room owner left. Room closed."
      });
      io.in(roomCode).socketsLeave(roomCode);
      rooms.delete(roomCode);
    }

    if (room.users.length === 0) {
      rooms.delete(roomCode);
    }
  });
});

// === Server Start ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
