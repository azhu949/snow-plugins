// 长文本切分：优先段落边界，其次换行与句末标点，最后硬切。
export function splitText(input, limit) {
  const source = String(input ?? "");
  const max = Math.max(200, Number(limit) || 3000);
  if (source.length <= max) return source ? [source] : [];

  const chunks = [];
  let rest = source;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.4) cut = window.lastIndexOf("\n");
    if (cut < max * 0.4) {
      cut = Math.max(
        window.lastIndexOf("。"),
        window.lastIndexOf("！"),
        window.lastIndexOf("？"),
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
    }
    if (cut < max * 0.4) cut = max - 1;
    const chunk = rest.slice(0, cut + 1);
    if (chunk.trim()) chunks.push(chunk);
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}
