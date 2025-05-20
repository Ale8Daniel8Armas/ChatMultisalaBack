const rooms = {};
const emptyRoomTimers = {}; // Objeto para guardar los timers

// Genera un PIN único de 6 dígitos
function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[pin]);
  return pin;
}

// Crea una nueva sala de chat
function createRoom(nickname, limit, socketId, deviceId) {
  if (!nickname || !limit || !deviceId) {
    throw new Error("Faltan parámetros requeridos para crear sala");
  }

  const pin = generatePin();
  rooms[pin] = {
    pin,
    limit: parseInt(limit),
    ownerDeviceId: deviceId,
    ownerNickname: nickname,
    users: [{ nickname, socketId, deviceId }], // El creador se une automáticamente
    createdAt: new Date().toISOString(),
  };

  console.log(`Sala creada: ${pin} por ${deviceId}`);
  return rooms[pin];
}

// Obtiene una sala por su PIN
function getRoomByPin(pin) {
  return rooms[pin];
}

function hasDuplicateConnection(pin, deviceId) {
  if (!rooms[pin]) return false;

  const connections = rooms[pin].users.filter((u) => u.deviceId === deviceId);
  return connections.length > 0;
}

function joinRoom(pin, nickname, socketId, deviceId) {
  if (!rooms[pin]) {
    throw new Error(`La sala ${pin} no existe`);
  }

  /*
  // Verificar si el usuario ya está en la sala para actualizar su socketId
  const existingUserIndex = rooms[pin].users.findIndex(
    (u) => u.deviceId === deviceId
  );

  if (existingUserIndex >= 0) {
    // Actualizar socketId si es una reconexión
    rooms[pin].users[existingUserIndex].socketId = socketId;
  } else {
    // Nuevo usuario
    rooms[pin].users.push({
      nickname,
      socketId,
      deviceId,
      joinedAt: new Date().toISOString(),
    }); */

  if (hasDuplicateConnection(pin, deviceId)) {
    throw new Error("Ya estás conectado a esta sala desde este dispositivo");
  }

  rooms[pin].users.push({
    nickname,
    socketId,
    deviceId,
    joinedAt: new Date().toISOString(),
  });
}

// Elimina un usuario de una sala
function leaveRoom(pin, socketId, deviceId) {
  const room = rooms[pin];
  if (!room) return;

  const initialCount = room.users.length;
  room.users = room.users.filter(
    (u) => u.socketId !== socketId && u.deviceId !== deviceId
  );

  if (room.users.length === 0 && initialCount > 0) {
    // Programar eliminación después de 5 minutos (300000 ms)
    emptyRoomTimers[pin] = setTimeout(() => {
      if (rooms[pin] && rooms[pin].users.length === 0) {
        delete rooms[pin];
        console.log(`Sala ${pin} eliminada por estar vacía (tiempo expirado)`);
      }
      delete emptyRoomTimers[pin];
    }, 300000); // 5 minutos = 300,000 ms

    console.log(
      `Sala ${pin} marcada para eliminación en 5 minutos si permanece vacía`
    );
  } else if (room.users.length < initialCount) {
    console.log(`Usuario ${deviceId} abandonó la sala ${pin}`);

    // Cancelar timer si alguien se reconectó
    if (emptyRoomTimers[pin]) {
      clearTimeout(emptyRoomTimers[pin]);
      delete emptyRoomTimers[pin];
      console.log(`Timer de eliminación cancelado para sala ${pin}`);
    }
  }
}

// Elimina una sala (solo puede hacerlo el creador)
function deleteRoom(pin, deviceId) {
  const room = rooms[pin];
  if (!room) {
    console.log(`Intento de eliminar sala inexistente: ${pin}`);
    return false;
  }

  // Cancelar timer si existe
  if (emptyRoomTimers[pin]) {
    clearTimeout(emptyRoomTimers[pin]);
    delete emptyRoomTimers[pin];
  }

  if (room.ownerDeviceId !== deviceId) {
    console.log(
      `Intento no autorizado de eliminar sala ${pin} por ${deviceId}`
    );
    return false;
  }

  delete rooms[pin];
  console.log(`Sala ${pin} eliminada por su creador ${deviceId}`);
  return true;
}

// Elimina todas las salas vacías
function removeEmptyRooms() {
  const beforeCount = Object.keys(rooms).length;

  for (const pin in rooms) {
    if (rooms[pin].users.length === 0) {
      delete rooms[pin];
    }
  }

  const removed = beforeCount - Object.keys(rooms).length;
  if (removed > 0) {
    console.log(`Se eliminaron ${removed} salas vacías`);
  }
}

// Verifica si un dispositivo ya está en alguna sala
function isDeviceConnected(deviceId) {
  return Object.values(rooms).some((room) =>
    room.users.some((u) => u.deviceId === deviceId)
  );
}

// Obtiene todas las salas activas con información resumida
function getActiveRooms() {
  return Object.values(rooms)
    .filter((room) => room.users.length > 0) // Solo salas con usuarios
    .map(({ pin, users, limit }) => ({
      pin,
      count: users.length,
      limit,
      hasSpace: users.length < limit,
    }));
}

/*
function getActiveRooms() {
  return Object.values(rooms)
    .filter((room) => Array.isArray(room.users) && room.users.length > 0)
    .map(({ pin, users, limit }) => ({
      pin,
      count: users.length,
      limit,
      hasSpace: users.length < limit,
    }));
}
*/

module.exports = {
  createRoom,
  getRoomByPin,
  joinRoom,
  hasDuplicateConnection,
  leaveRoom,
  deleteRoom,
  removeEmptyRooms,
  isDeviceConnected,
  getActiveRooms,
};
