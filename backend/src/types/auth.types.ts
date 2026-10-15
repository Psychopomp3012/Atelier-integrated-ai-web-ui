export type AIPlatform =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'claude_subscription'
  | 'codex_subscription'
  | 'custom';

export interface LinkedAIPlatformAccount {
  platform: AIPlatform;
  accountId: string;
  accountEmail?: string;
  connectedAt: string;
  hasValidSession: boolean;
  tier?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  primaryPlatform: 'google' | 'openai' | 'anthropic';
  linkedPlatforms: LinkedAIPlatformAccount[];
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  expiresAt: string;
}

export interface GoogleLoginRequest {
  idToken: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface DeviceAuthInitiateResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  platform: 'claude_subscription' | 'codex_subscription';
}

export interface DeviceAuthVerifyRequest {
  deviceCode: string;
  platform: 'claude_subscription' | 'codex_subscription';
}

export interface LoginWithPlatformRequest {
  platform: AIPlatform;
  authCode?: string;
  apiKey?: string;
  email?: string;
  name?: string;
}

export interface ConnectPlatformRequest {
  platform: AIPlatform;
  apiKey?: string;
  authCode?: string;
}
