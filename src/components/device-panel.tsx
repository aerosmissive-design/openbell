import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

const NAMES = ["G_PC", "G_DS225+", "G_DS423+"] as const;

type Freshness = "ONLINE" | "DELAYED" | "OFFLINE" | "NONE";

type DeviceRow = {
  deviceId: string;
  name: string;
  status: "ACTIVE" | "REVOKED";
  hostname: string;
  agentVersion: string;
  ownerUserId: string;
  sharedUserIds: string[];
  lastSeenAt: string;
  lastJobClaimAt: string;
  freshness: Freshness;
};

type Pending = {
  pairingRequestId: string;
  deviceName: string;
  deviceType: string;
  hostname: string;
  agentVersion: string;
  pairingCode: string;
  expiresAt: string;
};

type GasRow = { deviceName: string; status: string; lastSeen: string; lastJobClaim: string };

function hm(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "없음";
  return new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

function freshnessOf(iso: string): Freshness {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "NONE";
  const age = Date.now() - t;
  if (age <= 2 * 60 * 1000) return "ONLINE";
  if (age <= 5 * 60 * 1000) return "DELAYED";
  return "OFFLINE";
}

function dot(state: Freshness) {
  return cn(
    "inline-block size-2 rounded-full",
    state === "ONLINE" && "bg-emerald-500",
    state === "DELAYED" && "bg-amber-400",
    state === "OFFLINE" && "bg-red-500",
    state === "NONE" && "bg-zinc-500",
  );
}

function label(state: Freshness) {
  if (state === "ONLINE") return "정상";
  if (state === "DELAYED") return "지연";
  if (state === "OFFLINE") return "미응답";
  return "없음";
}

export function DevicePanel() {
  const { user } = useCurrentUserState();
  const [pending, setPending] = useState<Pending[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [gas, setGas] = useState<GasRow[]>([]);
  const [userId, setUserId] = useState("");
  const [locked, setLocked] = useState("");

  async function reload() {
    const res = await fetch("/api/device/list", { credentials: "include" });
    if (res.status === 401) {
      setPending([]);
      setDevices([]);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { pending?: Pending[]; devices?: DeviceRow[]; gas?: GasRow[]; userId?: string };
    setPending(data.pending || []);
    setDevices(data.devices || []);
    setGas(data.gas || []);
    setUserId(data.userId || "");
  }

  useEffect(() => {
    const timer = window.setInterval(() => void reload().catch(() => undefined), 20_000);
    void reload().catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  async function post(path: string, body: unknown, okText: string) {
    setLocked(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error === "NEED_TRANSFER" ? "다른 계정에 연결돼 있습니다. 교체를 누르세요." : "처리하지 못했습니다.");
        return data.error || "";
      }
      toast.success(okText);
      await reload();
      return "";
    } finally {
      setLocked("");
    }
  }

  const me = userId || user?.id || "";

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">서버 상태</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">PC·NAS가 켜지면 여기 승인 요청이 뜹니다. 주소나 토큰은 입력하지 않습니다.</p>
      {!user ? <p className="mt-2 text-sm text-muted">기기 승인은 로그인한 뒤에 됩니다.</p> : null}
      {pending.map((row) => (
        <div key={row.pairingRequestId} className="mt-3 rounded-md bg-bg p-3 text-sm">
          <p className="font-medium text-fg">{row.deviceName} 연결 요청</p>
          <p className="mt-1 text-muted">{row.deviceType === "PC" ? "Windows PC" : "NAS"} · {row.hostname || "이름 없음"}</p>
          <p className="text-muted">Agent {row.agentVersion || "-"}</p>
          <p className="mt-2 text-fg">인증 코드 {row.pairingCode}</p>
          <p className="text-xs text-muted">기기 화면에 같은 코드가 있는지 확인하세요.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={Boolean(locked)} className="min-h-11 rounded-md bg-black text-sm text-white" onClick={() => void post("/api/device/pair/approve", { pairingRequestId: row.pairingRequestId, mode: "approve" }, "연결했습니다.")}>승인</button>
            <button type="button" disabled={Boolean(locked)} className="min-h-11 rounded-md bg-bg text-sm text-muted ring-1 ring-border" onClick={() => void post("/api/device/pair/reject", { pairingRequestId: row.pairingRequestId }, "거부했습니다.")}>거부</button>
          </div>
          <button type="button" disabled={Boolean(locked)} className="mt-2 min-h-11 w-full text-sm text-muted" onClick={async () => {
            const error = await post("/api/device/pair/approve", { pairingRequestId: row.pairingRequestId, mode: "approve" }, "연결했습니다.");
            if (error === "NEED_TRANSFER") {
              await post("/api/device/pair/approve", { pairingRequestId: row.pairingRequestId, mode: "replace" }, "이 계정으로 바꿨습니다. 기기가 새 키를 받습니다.");
            }
          }}>다른 계정이면 이 계정으로 교체</button>
        </div>
      ))}
      <PathTable title="베셀" rows={NAMES.map((name) => {
        const row = devices.find((item) => item.name === name && item.status === "ACTIVE");
        return {
          name,
          freshness: row?.freshness || "NONE",
          seen: row?.lastSeenAt || "",
          claim: row?.lastJobClaimAt || "",
          device: row,
        };
      })} me={me} onShare={(id) => void post("/api/device/share", { deviceId: id }, "이 계정과 공유합니다.")} onReplace={(id) => void post("/api/device/replace", { deviceId: id }, "키를 폐기했습니다. 기기에서 다시 승인하세요.")} onRevoke={(id) => void post("/api/device/revoke", { deviceId: id }, "연결을 해제했습니다.")} />
      <PathTable title="GAS" rows={NAMES.map((name) => {
        const row = gas.find((item) => item.deviceName === name);
        return { name, freshness: freshnessOf(row?.lastSeen || ""), seen: row?.lastSeen || "", claim: row?.lastJobClaim || "" };
      })} me={me} />
    </div>
  );
}

function PathTable({
  title,
  rows,
  me,
  onShare,
  onReplace,
  onRevoke,
}: {
  title: string;
  rows: { name: string; freshness: Freshness; seen: string; claim: string; device?: DeviceRow }[];
  me: string;
  onShare?: (id: string) => void;
  onReplace?: (id: string) => void;
  onRevoke?: (id: string) => void;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs text-muted">{title}</p>
      <div className="mt-2 overflow-hidden rounded-md ring-1 ring-border">
        <div className="grid grid-cols-4 gap-2 bg-bg px-2 py-2 text-xs text-muted">
          <span>기기</span><span>상태</span><span>응답</span><span>잡</span>
        </div>
        {rows.map((row) => {
          const mine = Boolean(row.device && (row.device.ownerUserId === me || row.device.sharedUserIds.includes(me)));
          const other = Boolean(row.device && row.device.ownerUserId && row.device.ownerUserId !== me && !row.device.sharedUserIds.includes(me));
          return (
            <div key={`${title}-${row.name}`} className="border-t border-border px-2 py-2 text-sm">
              <div className="grid grid-cols-4 gap-2">
                <span className="text-fg">{row.name}</span>
                <span className="flex items-center gap-1.5 text-muted"><span className={dot(row.freshness)} />{label(row.freshness)}</span>
                <span className="tabular-nums text-muted">{hm(row.seen)}</span>
                <span className="tabular-nums text-muted">{hm(row.claim)}</span>
              </div>
              {row.device && mine && row.device.ownerUserId === me && onRevoke ? (
                <button type="button" className="mt-1 min-h-11 text-xs text-muted" onClick={() => onRevoke(row.device!.deviceId)}>연결 해제</button>
              ) : null}
              {row.device && other && onReplace && onShare ? (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" className="min-h-11 rounded-md bg-bg text-xs text-fg ring-1 ring-border" onClick={() => onReplace(row.device!.deviceId)}>교체</button>
                  <button type="button" className="min-h-11 rounded-md bg-bg text-xs text-fg ring-1 ring-border" onClick={() => onShare(row.device!.deviceId)}>공유</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
