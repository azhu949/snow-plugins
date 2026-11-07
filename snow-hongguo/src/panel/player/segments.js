import { PanelError } from "../rpc.js";
import { decodeBase64 } from "./util.js";

/** 有界并发拉取，仍按编号交付解析；取消后不再调度，已在途失败全部被接住。 */
export async function* readSegments({ rpc, episodeId, quality, count, cancelled, concurrency = 3 }) {
  const pending = new Map();
  let next = 1;
  const fill = () => {
    while (!cancelled() && next <= count && pending.size < concurrency) {
      const seq = next++;
      pending.set(seq, Promise.resolve().then(() => cancelled() ? null : rpc.getStreamSegment(episodeId, quality, seq))
        .then((payload) => ({ payload }), (error) => ({ error })));
    }
  };
  fill();
  for (let seq = 1; seq <= count; seq += 1) {
    if (cancelled()) return;
    const result = await pending.get(seq);
    if (cancelled()) return;
    pending.delete(seq);
    if (result.error) throw result.error;
    const bytes = decodeBase64(result.payload?.base64);
    if (!bytes.length) throw new PanelError("PROTOCOL", `分片 ${seq} 内容为空`);
    yield { seq, bytes };
    fill();
  }
}
