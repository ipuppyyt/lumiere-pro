import { useStore } from "zustand";
import { createEditorStore } from "../state/editorStore";
import { httpTransport } from "../state/transport";

// Packaged app: the Rust shell injects the host token. Dev: the Vite proxy adds it, so none is needed.
const token = (globalThis as { __CE_TOKEN__?: string }).__CE_TOKEN__;

export const editor = createEditorStore(httpTransport("", token ? { authorization: `Bearer ${token}` } : {}));

export function useEditor<T>(selector: (s: ReturnType<typeof editor.getState>) => T): T {
  return useStore(editor, selector);
}
