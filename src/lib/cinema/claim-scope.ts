import { collectRegisteredEmails } from "./registered-emails";

export type ClaimEmailScope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "emails"; emails: string[] };

/**
 * 공유 토큰의 베셀 작업 범위.
 * 메일 필드가 없으면 기존처럼 전체를 집는다.
 * 빈 배열이나 메일이 아닌 값만 있으면 작업을 집지 않는다.
 * 메일이 있으면 그 주소만 남긴다.
 */
export function claimEmailScope(value: unknown): ClaimEmailScope {
  if (value === undefined) return { kind: "all" };
  if (!Array.isArray(value)) return { kind: "none" };
  const emails = collectRegisteredEmails(value).slice(0, 20);
  if (emails.length === 0) return { kind: "none" };
  return { kind: "emails", emails };
}
