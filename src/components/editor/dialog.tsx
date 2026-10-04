"use client";
import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function DeskDialog({ open, onClose, title, description, children, reader = false, busy = false }: {
  open: boolean; onClose: () => void; title: string; description: string; children: ReactNode; reader?: boolean; busy?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="desk-dialog-overlay" />
    <Dialog.Content className={`desk-dialog${reader ? " desk-source-dialog" : ""}`} onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onInteractOutside={e => { if (busy) e.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <div className="desk-dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><button className="button secondary" disabled={busy} aria-label="Close dialog">Close ×</button></Dialog.Close></div>
      <Dialog.Description className="desk-hint">{description}</Dialog.Description>{children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function ChargeNotice({ attempts }: { attempts: number }) {
  return <p className="desk-hint">{attempts} of 10 model attempts used today (UTC). {Math.max(0, 10 - attempts)} remaining. Each batch processes up to three drafts; remaining selected work stays queued. Failed or interrupted requests may still incur charges. Publication always stays manual.</p>;
}
