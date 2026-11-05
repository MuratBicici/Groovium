/*
 * Off the page's main thread: blocks of sound from the worklet, out over a socket
 * to the equaliser in Rust. See src/platform/tabTap.ts. A message back to the page
 * means the socket has gone, and with it the sound.
 */

self.onmessage = (event) => {
  const { url, port } = event.data;
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  port.onmessage = (block) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(block.data);
  };
  socket.onclose = () => self.postMessage('closed');
};
