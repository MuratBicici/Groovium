/*
 * Off the page's main thread: blocks of sound from the worklet, out over a socket
 * to the equaliser in Rust. See src/platform/tabTap.ts. The page is told when the
 * socket opens and when it closes, and sends another address if there is one.
 */

let socket = null;

self.onmessage = (event) => {
  const { url, port } = event.data;
  if (port) {
    port.onmessage = (block) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(block.data);
    };
  }
  const mine = new WebSocket(url);
  mine.binaryType = 'arraybuffer';
  mine.onopen = () => {
    if (mine === socket) self.postMessage('open');
  };
  mine.onclose = () => {
    if (mine === socket) self.postMessage('closed');
  };
  socket = mine;
};
