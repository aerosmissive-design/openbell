export function SettingsView({ lastScan }: { lastScan: unknown }) {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-border">
      <p className="text-sm text-muted">
        설정 화면을 복구하는 중입니다. 잠시 후 새로고침해 주세요.
      </p>
    </div>
  );
}
