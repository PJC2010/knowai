"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  KeyRound,
  ShieldCheck,
  ExternalLink,
  Check,
  Wallet,
  Link2,
} from "@/components/icons";
import { API, apiError } from "@/lib/openrouter";

type Connection = {
  apiKey: string;
  connected: boolean;
  openConnect: () => void;
  disconnect: () => void;
};
const ConnectionContext = createContext<Connection>({
  apiKey: "",
  connected: false,
  openConnect: () => {},
  disconnect: () => {},
});
export const useConnection = () => useContext(ConnectionContext);
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const callbackHandled = useRef(false);

  useEffect(() => {
    if (callbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) return;
    callbackHandled.current = true;
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    ["code", "state", "error", "error_description"].forEach((k) =>
      params.delete(k),
    );
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}`,
    );
    setOpen(true);
    setBusy(true);
    (async () => {
      try {
        const raw = sessionStorage.getItem("knowai-oauth");
        sessionStorage.removeItem("knowai-oauth");
        const saved = raw ? JSON.parse(raw) : null;
        if (oauthError || !code)
          throw new Error(
            "Connection was canceled. You can try again or paste a key.",
          );
        if (
          !saved ||
          state !== saved.state ||
          Date.now() - saved.created > 600000
        )
          throw new Error(
            "This connection link expired or could not be verified. Please try connecting again.",
          );
        const response = await fetch(`${API}/auth/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            code_verifier: saved.verifier,
            code_challenge_method: "S256",
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok)
          throw new Error(
            "OpenRouter could not finish connecting. Please try again.",
          );
        const body = await response.json();
        if (typeof body.key !== "string" || !body.key)
          throw new Error("No key was returned. Please try again.");
        setApiKey(body.key);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Connection failed. Please try again.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  async function connectAccount() {
    setError("");
    setBusy(true);
    try {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      sessionStorage.setItem(
        "knowai-oauth",
        JSON.stringify({ verifier, state, created: Date.now() }),
      );
      const url = new URL("https://openrouter.ai/auth");
      url.search = new URLSearchParams({
        callback_url: `${window.location.origin}/playground`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        key_label: "knowai",
      }).toString();
      window.location.assign(url.href);
    } catch {
      setError(
        "Your browser could not start account connection. You can paste an API key below instead.",
      );
      setBusy(false);
    }
  }
  async function connectKey(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const key = draft.trim();
      const response = await fetch(`${API}/key`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(apiError(response.status));
      setApiKey(key);
      setDraft("");
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TypeError"
          ? e.message
          : "Could not reach OpenRouter. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConnectionContext.Provider
      value={{
        apiKey,
        connected: !!apiKey,
        openConnect: () => {
          setError("");
          setOpen(true);
        },
        disconnect: () => {
          setApiKey("");
          setDraft("");
        },
      }}
    >
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setDraft("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Close
              className="icon-button dialog-close"
              aria-label="Close connection dialog"
              disabled={busy}
            >
              <X size={20} />
            </Dialog.Close>
            <div className="dialog-symbol">
              <KeyRound size={26} />
            </div>
            <Dialog.Title>
              {apiKey ? "You’re connected." : "Your key to exploring AI."}
            </Dialog.Title>
            <Dialog.Description>
              {apiKey
                ? "Your OpenRouter account is ready to use in the playground."
                : "One OpenRouter account. Hundreds of models. Pay only for what you use."}
            </Dialog.Description>
            {apiKey ? (
              <div className="connection-success">
                <p>
                  <Check size={20} /> OpenRouter connected for this visit
                </p>
                <a
                  className="button secondary full"
                  href="https://openrouter.ai/settings/credits"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Wallet size={17} /> Add credits on OpenRouter{" "}
                  <ExternalLink size={14} />
                </a>
                <Dialog.Close className="button primary full">
                  Start exploring
                </Dialog.Close>
                <button className="text-button" onClick={() => setApiKey("")}>
                  Disconnect account
                </button>
              </div>
            ) : (
              <>
                <div className="setup-steps">
                  <div>
                    <span>1</span>
                    <p>
                      <strong>Add a little credit</strong>
                      <small>
                        Keys are free. Buy usage credits on OpenRouter.
                      </small>
                    </p>
                    <a
                      href="https://openrouter.ai/settings/credits"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Buy credits on OpenRouter"
                    >
                      <ExternalLink size={17} />
                    </a>
                  </div>
                  <div>
                    <span>2</span>
                    <p>
                      <strong>Connect your account</strong>
                      <small>
                        Choose a spending limit you’re comfortable with.
                      </small>
                    </p>
                  </div>
                </div>
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={connectAccount}
                >
                  {busy ? (
                    <span className="button-progress" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <Link2 size={17} />
                  )}{" "}
                  {busy ? "Connecting…" : "Connect with OpenRouter"}
                </button>
                <div className="or-divider">
                  <span>or use an existing key</span>
                </div>
                <form onSubmit={connectKey}>
                  <label className="field-label" htmlFor="api-key">
                    OpenRouter API key
                  </label>
                  <div className="key-field">
                    <input
                      id="api-key"
                      type="password"
                      autoComplete="off"
                      placeholder="sk-or-v1-…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      required
                      disabled={busy}
                    />
                    <button
                      className="button secondary"
                      disabled={busy || !draft.trim()}
                      type="submit"
                    >
                      Connect
                    </button>
                  </div>
                </form>
                <a
                  className="small-link"
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create a key on OpenRouter <ExternalLink size={12} />
                </a>
              </>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <p className="privacy-note">
              <ShieldCheck size={17} />
              <span>
                Your key stays in this page’s memory and is sent only to
                OpenRouter. Refreshing disconnects it. Prompts go to OpenRouter
                and the selected model providers.
              </span>
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConnectionContext.Provider>
  );
}
