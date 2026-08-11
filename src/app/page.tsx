import { LedgerApp } from "@/components/ledger/ledger-app";

/**
 * 首页就是账本。
 *
 * 页面本身是服务端组件，只负责挂载。所有状态在 LedgerApp 里——账本数据存在
 * localStorage，服务端拿不到也不该拿到（CLAUDE.md §3）。
 */
export default function Home() {
  return <LedgerApp />;
}
