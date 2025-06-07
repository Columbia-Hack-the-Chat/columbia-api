import { WASocket } from 'baileys'

let socket: WASocket | null = null

export function setSocket(sock: WASocket | null) {
    socket = sock
}

export function getSocket(): WASocket | null {
    return socket
}

export async function disconnectSocket() {
    if (socket) {
        await socket.logout()
    }
}
