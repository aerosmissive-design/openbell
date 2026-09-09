export const GAS_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const GAS_OAUTH_MESSAGE = "openbell-gas-oauth";

export function gasOauthRedirectUri() {
  return `${window.location.origin}/gas-oauth`;
}

export function gasOauthStartPath(email?: string) {
  const mail = String(email || "").trim();
  return mail ? `/gas-oauth?email=${encodeURIComponent(mail)}` : "/gas-oauth";
}

export function googleAuthUrl(clientId: string, email?: string) {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", gasOauthRedirectUri());
  auth.searchParams.set("response_type", "token");
  auth.searchParams.set("scope", GAS_OAUTH_SCOPES);
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("include_granted_scopes", "true");
  const mail = String(email || "").trim();
  if (mail) auth.searchParams.set("login_hint", mail);
  return auth.toString();
}
