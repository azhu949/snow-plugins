import { createTempoProcessor } from "./tempo-processing.js";

let processor = null;
self.onmessage = (event) => {
  try {
    processor ??= createTempoProcessor(event.data);
    const result = processor.append(event.data.planes, event.data.final === true);
    self.postMessage({ type: "chunk", ...result }, result.planes.map((plane) => plane.buffer));
    if (result.final) self.close();
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
    self.close();
  }
};
