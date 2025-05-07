const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', (username) => {
    const roomId = uuidv4();
    rooms.set(roomId, {
      users: new Map([[socket.id, username]]),
      messages: []
    });
    socket.join(roomId);
    socket.emit('room_created', { roomId, username });
  });

  // Rest of the socket.io logic from previous answer
  // [Include all the socket.io event handlers from previous implementation]
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
