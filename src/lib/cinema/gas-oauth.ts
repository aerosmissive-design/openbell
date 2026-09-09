export const GAS_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const GAS_OAUTH_MESSAGE = "openbell-gas-oauth";

export function gasOauthStartPath(email?: string) {
  const mail = String(email || "").trim();
  return mail ? `/gas-oauth?email=${encodeURIComponent(mail)}` : "/gas-oauth";
}
