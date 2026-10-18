import { atom, type PrimitiveAtom } from 'jotai';
import type { UserProfile } from '../types';
import type { CliStatus } from '../services/cliAuth.service';

export const currentUserAtom: PrimitiveAtom<UserProfile | null> = atom<UserProfile | null>(null);
export const isAuthModalOpenAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
export const cliStatusAtom: PrimitiveAtom<CliStatus> = atom<CliStatus>({
  gemini: { linked: false },
  claude: { linked: false },
  codex: { linked: false },
});
