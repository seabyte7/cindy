/**
 * DSH ACP 的逐行 transport 抽象。
 *
 * maker-core 不拥有进程、DSH_HOME 或凭证；Desktop Main/SSH host 把已经建立的
 * 受控字节流注入这里。这样 protocol client 可以在本机与远端共用，也不会把特权
 * 交给 Renderer。
 */

export type DshAcpLineHandler = (line: string) => void;

export interface DshAcpTransportCloseInfo {
  reason: string;
}

export type DshAcpCloseHandler = (info: DshAcpTransportCloseInfo) => void;

export interface DshAcpTransport {
  writeLine(line: string): Promise<void>;
  onLine(handler: DshAcpLineHandler): () => void;
  onClose(handler: DshAcpCloseHandler): () => void;
  close(reason?: string): Promise<void>;
}
