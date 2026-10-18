import { atom, type PrimitiveAtom } from 'jotai';
import type { ChatMessage, ChatSession } from '../types';

export const currentSessionIdAtom: PrimitiveAtom<string | null> = atom<string | null>(null);
export const sessionsAtom: PrimitiveAtom<ChatSession[]> = atom<ChatSession[]>([]);
export const messagesAtom: PrimitiveAtom<ChatMessage[]> = atom<ChatMessage[]>([]);
export const isGeneratingAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
