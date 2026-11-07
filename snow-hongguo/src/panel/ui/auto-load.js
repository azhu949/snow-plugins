import { getReact } from "./runtime.js";

/** 接近底部、首屏未填满或窗口扩容时补页；错误与隐藏状态由调用方暂停。 */
export function useAutoLoadMore({ active, ready, hasMore, cursor, scrollRef, sentinelRef, load }) {
  const React = getReact();
  React.useEffect(() => {
    if (!active || !ready || !hasMore) return undefined;
    const root = scrollRef.current;
    if (!root) return undefined;
    let disposed = false;
    const check = () => {
      if (!disposed && root.clientHeight > 0 && root.scrollHeight - root.scrollTop - root.clientHeight < 240) load();
    };
    const intersection = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(check, { root, rootMargin: "240px 0px" }) : null;
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    if (sentinelRef.current) intersection?.observe(sentinelRef.current);
    resize?.observe(root);
    root.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    return () => {
      disposed = true;
      intersection?.disconnect();
      resize?.disconnect();
      root.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [active, ready, hasMore, cursor, scrollRef, sentinelRef, load]);
}
