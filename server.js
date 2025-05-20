require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dns = require("dns");

const {
  createRoom,
  getRoomByPin,
  joinRoom,
  leaveRoom,
  hasDuplicateConnection,
  deleteRoom,
  removeEmptyRooms,
  isDeviceConnected,
  getActiveRooms,
} = require("./controllers/roomManager");

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} no permitido`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

// Endpoint para obtener salas activas
app.get("/rooms", (req, res) => {
  try {
    const rooms = getActiveRooms().map(({ pin, count, limit }) => ({
      pin,
      count,
      limit,
    }));
    res.json(rooms);
  } catch (error) {
    console.error("Error al obtener salas:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para crear nueva sala
app.post("/rooms", (req, res) => {
  try {
    const { nickname, limit, deviceId } = req.body;

    if (!nickname || !limit || !deviceId) {
      return res.status(400).json({ error: "Faltan parámetros requeridos" });
    }

    if (isDeviceConnected(deviceId)) {
      return res.status(400).json({
        error: "Este dispositivo ya está en una sala",
      });
    }

    const room = createRoom(nickname, parseInt(limit), null, deviceId);
    console.log(`Sala creada PIN=${room.pin}, límite=${room.limit}`);
    res.json({ pin: room.pin });
  } catch (error) {
    console.error("Error al crear sala:", error);
    res.status(500).json({ error: "Error al crear sala" });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Socket.IO CORS: origin ${origin} no permitido`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// Manejo de conexiones Socket.IO
io.on("connection", (socket) => {
  const clientIp = (
    socket.handshake.headers["x-forwarded-for"]?.split(",")[0] ||
    socket.handshake.address
  ).replace("::ffff:", "");
  const deviceId = socket.handshake.query.deviceId;

  dns.reverse(clientIp, (err, hostnames) => {
    const hostname = err ? clientIp : hostnames[0];
    socket.emit("host_info", { ip: clientIp, hostname });
    console.log(
      `🔌 Conexión: socketId=${socket.id}, deviceId=${deviceId}, ip=${clientIp}`
    );
  });

  // Evento para obtener lista de salas
  socket.on("get_rooms", () => {
    try {
      const rooms = getActiveRooms().map(({ pin, count, limit }) => ({
        pin,
        count,
        limit,
      }));
      socket.emit("rooms_data", rooms);
    } catch (error) {
      console.error("Error al obtener salas:", error);
    }
  });

  // Evento para crear sala desde el socket
  socket.on("create_room", ({ nickname, limit, deviceId }, cb) => {
    try {
      if (!nickname || !limit || !deviceId) {
        return cb({ success: false, message: "Faltan parámetros requeridos" });
      }

      // Verificamos si el dispositivo ya está en UNA SALA DIFERENTE
      if (isDeviceConnected(deviceId)) {
        const currentRoom = Object.values(rooms).find((room) =>
          room.users.some((u) => u.deviceId === deviceId)
        );
        if (currentRoom && currentRoom.pin !== socket.data?.pin) {
          return cb({
            success: false,
            message: "Este dispositivo ya está en otra sala",
          });
        }
      }

      const room = createRoom(nickname, parseInt(limit), socket.id, deviceId);
      console.log(
        `Sala creada via socket PIN=${room.pin}, límite=${room.limit}`
      );

      // Unimos el creador a la sala
      socket.join(room.pin);
      socket.data = {
        pin: room.pin,
        deviceId,
        nickname,
        isHost: true, // Marcamos como anfitrión
      };

      // Emitimos los datos actualizados de la sala
      io.to(room.pin).emit("room_data", {
        users: room.users,
        limit: room.limit,
      });

      cb({ success: true, pin: room.pin });
    } catch (error) {
      console.error("Error al crear sala:", error);
      cb({ success: false, message: "Error al crear sala" });
    }
  });

  /*
  // Evento para unirse a sala
  socket.on("join_room", ({ pin, nickname }, cb) => {
    try {
      const room = getRoomByPin(pin);
      if (!room) {
        console.log(`PIN inválido (${pin}) por ${nickname}`);
        return cb({ success: false, message: "PIN inválido" });
      }
      if (room.users.length >= room.limit) {
        console.log(`Sala llena: PIN=${pin}, intento por ${nickname}`);
        return cb({ success: false, message: "La sala está llena" });
      }

      // Permitir reconexión si es el mismo dispositivo
      const existingUser = room.users.find((u) => u.deviceId === deviceId);
      if (existingUser && existingUser.socketId !== socket.id) {
        // Actualizamos el socketId del usuario existente
        existingUser.socketId = socket.id;
        console.log(`✅ ${nickname} reconectado a sala ${pin}`);
      } else if (existingUser) {
        // Ya está conectado con este socket
        console.log(`Usuario ${nickname} ya está en la sala ${pin}`);
      } else {
        // Nuevo usuario
        joinRoom(pin, nickname, socket.id, deviceId);
        console.log(`✅ ${nickname} se unió a sala ${pin}`);
      }

      socket.join(pin);
      socket.data = { pin, deviceId, nickname };

      const updatedRoom = getRoomByPin(pin);
      io.to(pin).emit("room_data", {
        users: updatedRoom.users,
        limit: updatedRoom.limit,
      });

      cb({ success: true });
    } catch (error) {
      console.error("Error al unirse a sala:", error);
      cb({ success: false, message: "Error al unirse a sala" });
    }
  });
  */

  socket.on("join_room", ({ pin, nickname }, cb) => {
    try {
      const room = getRoomByPin(pin);
      if (!room) {
        console.log(`PIN inválido (${pin}) por ${nickname}`);
        return cb({ success: false, message: "PIN inválido" });
      }
      if (room.users.length >= room.limit) {
        console.log(`Sala llena: PIN=${pin}, intento por ${nickname}`);
        return cb({ success: false, message: "La sala está llena" });
      }

      // Verificar conexión duplicada
      if (hasDuplicateConnection(pin, deviceId)) {
        console.log(`Intento de conexión duplicada a ${pin} por ${deviceId}`);
        return cb({
          success: false,
          message: "Ya estás conectado a esta sala desde este dispositivo",
          redirect: true, // Bandera para redireccionar
        });
      }

      joinRoom(pin, nickname, socket.id, deviceId);
      socket.join(pin);
      socket.data = { pin, deviceId, nickname };
      console.log(`✅ ${nickname} se unió a sala ${pin}`);

      const updatedRoom = getRoomByPin(pin);
      io.to(pin).emit("room_data", {
        users: updatedRoom.users,
        limit: updatedRoom.limit,
      });

      cb({ success: true });
    } catch (error) {
      console.error("Error al unirse a sala:", error);
      cb({
        success: false,
        message: error.message,
        redirect: error.message.includes("Ya estás conectado"),
      });
    }
  });

  // Evento para enviar mensajes
  socket.on("send_message", ({ pin, autor, message }) => {
    try {
      console.log(`💬 [${pin}] ${autor}: ${message}`);
      io.to(pin).emit("receive_message", { autor, message });
    } catch (error) {
      console.error("Error al enviar mensaje:", error);
    }
  });

  // Evento para eliminar sala
  socket.on("delete_room", ({ pin }, cb) => {
    try {
      const { deviceId: did } = socket.data || {};
      const ok = deleteRoom(pin, did);
      if (!ok) {
        console.log(`No autorizado para eliminar sala ${pin} por ${did}`);
        return cb({ success: false, message: "No autorizado" });
      }
      console.log(`Sala ${pin} eliminada por ${did}`);
      io.to(pin).emit("room_deleted", { pin });
      cb({ success: true });
    } catch (error) {
      console.error("Error al eliminar sala:", error);
      cb({ success: false, message: "Error al eliminar sala" });
    }
  });

  // Manejo de desconexión
  socket.on("disconnect", () => {
    try {
      const { pin, deviceId: did, nickname } = socket.data || {};
      console.log(`Desconexión: nick=${nickname}, deviceId=${did}`);

      if (pin) {
        leaveRoom(pin, socket.id, did);
        const room = getRoomByPin(pin);

        if (room) {
          io.to(pin).emit("room_data", {
            users: room.users,
            limit: room.limit,
          });
        }

        // Eliminamos removeEmptyRooms() ya que ahora se maneja con timers
      }
    } catch (error) {
      console.error("Error en desconexión:", error);
    }
  });
  //Para verificar conexión activa
  socket.on("check_active_connection", ({ pin, deviceId }, cb) => {
    const isConnected = hasDuplicateConnection(pin, deviceId);
    cb({ isConnected });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
