import { atom, type PrimitiveAtom } from 'jotai';
import type { ChatMessage, ChatSessionDetails } from '../types';

export const currentSessionIdAtom: PrimitiveAtom<string | null> = atom<string | null>(null);
export const sessionsAtom: PrimitiveAtom<ChatSessionDetails[]> = atom<ChatSessionDetails[]>([]);
export const messagesAtom: PrimitiveAtom<ChatMessage[]> = atom<ChatMessage[]>([]);
export const isGeneratingAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
