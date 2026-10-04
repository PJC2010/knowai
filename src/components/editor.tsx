"use client";
import { useActionState } from "react";
import { loginEditor, type EditorActionState } from "@/app/editor/actions";
export { EditorDesk } from "./editor/desk";
const initial: EditorActionState = { ok: false, message: "" };
export function EditorLogin() {
  const [state, action, pending] = useActionState(loginEditor, initial);
  return <form action={action} className="editor-login"><label>Editor email<input type="email" name="email" required autoComplete="email" /></label><button className="button primary" disabled={pending}>{pending ? "Sending…" : "Send a sign-in link"}</button><p role="status">{state.message}</p></form>;
}
